/**
 * AI decision cycle cron — iterates over all active systems.
 *
 * For each active system:
 *  1. Expire stale human tasks (per-system)
 *  2. Pull recent readings + actions + pending tasks (per-system)
 *  3. Call brain (Claude with cached SYSTEM_PROMPT)
 *  4. Persist decision (per-system)
 *  5. Execute approved doses (sequentially)
 *  6. Persist any new human tasks
 *
 * Runtime caveat: dose execution sleeps for the dose duration; with multiple
 * systems each running multiple doses, total wall time could exceed the 60s
 * Vercel Pro Plus limit. For Phase 1 (single active system), well within budget.
 * When we hit it, fan out via Vercel Queue.
 */
import { NextResponse } from "next/server";
import {
  getRecentReadings,
  getRecentActions,
  getPendingTasks,
  getRecentDecisions,
  saveDecision,
  saveAction,
  createHumanTask,
  expireOldTasks,
  listSystems,
  saveChatMessage,
  setNextCheckAt,
  decrementBottle,
  getLastCronChatPush,
  addEpisode,
} from "@/lib/db";
import { analyzeAndDecide } from "@/lib/brain";
import { doseChannelByPhysical } from "@/lib/devices/jebao";
import { getDosingConfig } from "@/lib/dosing-config";
import { evaluateCycleGate, CYCLE_GATE } from "@/lib/cycle-gate";
import { getEffectiveTargets } from "@/lib/tolerance";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers.get("x-vercel-cron")) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const results: Array<Record<string, unknown>> = [];

  try {
    const systems = (await listSystems()).filter((s) => s.status === "active");

    for (const sys of systems) {
      const sysStart = Date.now();
      try {
        await expireOldTasks(sys.id);
        const recent = await getRecentReadings(24, 500, sys.id);
        if (recent.length === 0) {
          results.push({
            system_id: sys.id,
            ok: false,
            skipped: "no readings yet",
          });
          continue;
        }
        const current = recent[recent.length - 1];
        const recentActions = await getRecentActions(24, sys.id);
        const pendingTasks = await getPendingTasks(sys.id);

        // -------------------------------------------------------------------
        // Cycle gate — decide whether this tick is worth a Claude call.
        // -------------------------------------------------------------------
        const lastDecisions = await getRecentDecisions(1, sys.id);
        const lastDecision = lastDecisions[0] ?? null;
        // The reference reading is the one closest in time to the last
        // decision; readings is ordered chronologically so we walk backwards.
        let referenceReading = null;
        if (lastDecision) {
          const lastTs = lastDecision.ts.getTime();
          for (let i = recent.length - 1; i >= 0; i--) {
            if (recent[i].ts.getTime() <= lastTs) {
              referenceReading = recent[i];
              break;
            }
          }
        }
        const highPriCount = pendingTasks.filter(
          (t) => t.priority === "high" || t.priority === "urgent"
        ).length;
        const targets = getEffectiveTargets(sys);
        const gate = evaluateCycleGate({
          current,
          referenceReading,
          nextCheckAt: sys.next_check_at,
          pendingHighPriorityCount: highPriCount,
          lastDecisionStatus: lastDecision?.status ?? null,
          targets,
        });

        if (!gate.run_llm) {
          // SKIP path — record a zero-token decision row so the activity log
          // still shows we were alive, but don't push a chat message (would
          // be noise) and don't burn Claude tokens.
          const skipDecisionId = await saveDecision(
            {
              status: "healthy",
              analysis: `[gate-skip] ${gate.skip_reason}`,
              message: "",
              raw_response: { gate_skipped: true, reason: gate.skip_reason },
              tokens_input: 0,
              tokens_output: 0,
              cache_creation_tokens: 0,
              cache_read_tokens: 0,
            },
            sys.id
          );
          const nextAt = new Date(Date.now() + gate.next_check_minutes * 60_000);
          await setNextCheckAt(sys.id, nextAt);
          results.push({
            system_id: sys.id,
            ok: true,
            skipped: true,
            skip_reason: gate.skip_reason,
            decision_id: skipDecisionId,
            next_check_at: nextAt.toISOString(),
            duration_ms: Date.now() - sysStart,
          });
          continue;
        }

        // Resolve once per cycle so the brain + dose loop share one view of
        // the rig's physical channel layout.
        const dosingConfig = await getDosingConfig(sys.id);

        const decision = await analyzeAndDecide({
          current,
          recent,
          systemProfile: {
            system_type: sys.system_type,
            reservoir_liters: sys.reservoir_liters,
            crop_type: sys.crop_type,
            growth_stage: sys.growth_stage,
            location: sys.location,
            outdoor: sys.outdoor,
            // Feed the safety-critical context so the brain knows whether
            // its proposals execute or queue, and which bottles can
            // actually deliver liquid right now.
            autonomous_dosing_enabled: sys.autonomous_dosing_enabled,
            doser_verified: sys.doser_verified,
            bottle_levels: sys.bottle_levels,
          },
          recentActions: recentActions.map((a) => ({
            ts: a.ts,
            channel: a.channel,
            amount_ml: a.amount_ml,
            success: a.success,
            reason: a.reason,
          })),
          pendingTasks,
          dosingConfig,
          systemId: sys.id,
        });

        const decisionId = await saveDecision(
          {
            status: decision.status,
            analysis: decision.analysis,
            message: decision.message,
            raw_response: decision.raw_response,
            tokens_input: decision.tokens_input,
            tokens_output: decision.tokens_output,
            cache_creation_tokens: decision.cache_creation_tokens,
            cache_read_tokens: decision.cache_read_tokens,
          },
          sys.id
        );

        for (const t of decision.human_tasks) {
          await createHumanTask(
            {
              type: t.type,
              priority: t.priority,
              title: t.title,
              reason: t.reason,
              payload: t.payload,
              expires_in_hours: t.expires_in_hours,
              decision_id: decisionId,
            },
            sys.id
          );
        }

        const executed: Array<{ channel: string; amount_ml: number; success: boolean; error?: string }> = [];

        // CRITICAL SAFETY GATE: do not let the autonomous loop fire pumps
        // on a system whose grower hasn't explicitly enabled autonomous
        // dosing.  Instead, materialise each command as a dose_approval
        // Human Task so the grower can review + click "אשר ובצע" from the
        // dashboard.  This stops the failure mode where a fresh install's
        // brain ran overnight, burned through pH Down and nutrients, and
        // the grower woke up to empty bottles.
        if (!sys.autonomous_dosing_enabled) {
          for (const cmd of decision.commands) {
            try {
              await createHumanTask(
                {
                  type: "dose_approval",
                  priority: "high",
                  title: `אישור מנה: ${cmd.channel} ${cmd.amount_ml}ml`,
                  reason:
                    `המוח האוטונומי מציע ${cmd.amount_ml}ml ב-${cmd.channel}. ` +
                    `הסיבה: ${cmd.reason}. דישון אוטונומי כבוי במערכת — לחיצה על "אשר ובצע" תפעיל את המשאבה.`,
                  payload: {
                    channel: cmd.channel,
                    amount_ml: cmd.amount_ml,
                    reason_en: cmd.reason,
                    source: "cron-cycle-autonomous-disabled",
                  },
                  expires_in_hours: 4,
                  decision_id: decisionId,
                },
                sys.id
              );
            } catch (e) {
              console.error(`[cron/cycle] failed to create dose_approval task: ${e}`);
            }
            executed.push({
              channel: cmd.channel,
              amount_ml: cmd.amount_ml,
              success: false,
              error: "autonomous_dosing_enabled=false — proposal queued as dose_approval",
            });
          }
        } else {
          for (const cmd of decision.commands) {
            const phys = dosingConfig.assignments[cmd.channel]?.physical;
            if (!phys) {
              executed.push({
                channel: cmd.channel,
                amount_ml: cmd.amount_ml,
                success: false,
                error: `no physical channel mapped for '${cmd.channel}'`,
              });
              continue;
            }
            const r = await doseChannelByPhysical(phys, cmd.amount_ml, cmd.reason, cmd.channel);
            await saveAction(
              {
                channel: cmd.channel,
                amount_ml: cmd.amount_ml,
                reason: r.success ? cmd.reason : `FAILED: ${r.error}`,
                success: r.success,
                ai_status: decision.status,
                ai_analysis: decision.analysis,
                decision_id: decisionId,
              },
              sys.id
            );
            // Bottle-level bookkeeping — decrement only on confirmed-success
            // and only for non-priming actions (priming flows handle their
            // own decrement in the agent tool).
            if (r.success) {
              try {
                await decrementBottle(sys.id, cmd.channel, cmd.amount_ml);
              } catch (e) {
                console.error(`[cron/cycle] decrementBottle failed: ${e}`);
              }
            }
            executed.push({
              channel: cmd.channel,
              amount_ml: cmd.amount_ml,
              success: r.success,
              error: r.error,
            });
          }
        }

        // Episodic memory — log a compact narrative line for this cycle so
        // future cycles have continuity beyond the 24h action window.  Skip
        // the boring healthy-no-op cycles to keep the log meaningful.
        const successes = executed.filter((e) => e.success);
        const noteworthy =
          decision.status !== "healthy" ||
          executed.length > 0 ||
          decision.human_tasks.length > 0;
        if (noteworthy) {
          const actionText =
            successes.length > 0
              ? ` · dosed ${successes.map((e) => `${e.channel} ${e.amount_ml}ml`).join(", ")}`
              : executed.length > 0
              ? ` · proposed ${executed.length} dose(s) (queued for approval)`
              : decision.human_tasks.length > 0
              ? ` · raised ${decision.human_tasks.length} task(s)`
              : "";
          const base = (decision.message || decision.analysis || "cycle").slice(0, 220);
          try {
            await addEpisode(sys.id, {
              status: decision.status,
              summary: `${base}${actionText}`,
              decision_id: decisionId,
            });
          } catch (e) {
            console.error(`[cron/cycle] addEpisode failed: ${e}`);
          }
        }

        // Honour Claude's `next_check_minutes` for the cycle gate.  Floored
        // at CYCLE_GATE.min_skip_minutes when status=healthy so we don't
        // re-engage on the next cron tick when Claude said "all good".
        const claudeMin = Number(decision.next_check_minutes) || 60;
        const floored =
          decision.status === "healthy"
            ? Math.max(claudeMin, CYCLE_GATE.min_skip_minutes)
            : claudeMin;
        await setNextCheckAt(sys.id, new Date(Date.now() + floored * 60_000));

        // Chat-push suppression — the v0.3 POC chat history showed the
        // brain spamming "pH is high" every 2 hours for 3 days while the
        // grower already had a pending task.  Push ONLY when the situation
        // materially changed:
        //   1. status changed from last push (transition)
        //   2. new human task was created this cycle
        //   3. a real dose actually fired this cycle
        //   4. periodic alive-check: last push was 8h+ ago, regardless
        //
        // Otherwise the decision row is still saved (audit trail intact)
        // but the chat stays quiet so signal-to-noise stays usable.
        const lastPush = await getLastCronChatPush(sys.id);
        const statusChanged = lastPush?.status !== decision.status;
        const newTaskCreated = decision.human_tasks.length > 0;
        const dosesFired = executed.some((e) => e.success);
        const lastPushAgeHours = lastPush
          ? (Date.now() - lastPush.ts.getTime()) / (60 * 60 * 1000)
          : Infinity;
        const periodicCheckIn = lastPushAgeHours >= 8;

        const shouldPush =
          statusChanged || newTaskCreated || dosesFired || periodicCheckIn;

        if (shouldPush) {
          try {
            await saveChatMessage({
              systemId: sys.id,
              role: "assistant",
              parts: [
                {
                  type: "text",
                  text: decision.message || decision.analysis || "מחזור ניתוח אוטומטי הסתיים.",
                },
              ],
              source: "cron-cycle",
              decisionId,
              status: decision.status,
            });
          } catch (e) {
            console.error("[cron/cycle] failed to push chat message:", e);
          }
        } else {
          console.log(
            `[cron/cycle] system=${sys.id} chat push suppressed ` +
              `(status='${decision.status}' unchanged since ${lastPushAgeHours.toFixed(1)}h ago, ` +
              `no new tasks, no doses fired)`
          );
        }

        results.push({
          system_id: sys.id,
          ok: true,
          decision_id: decisionId,
          status: decision.status,
          commands_executed: executed,
          blocked: decision.blocked_commands,
          tasks_created: decision.human_tasks.length,
          next_check_minutes: decision.next_check_minutes,
          tokens: {
            input: decision.tokens_input,
            output: decision.tokens_output,
            cache_create: decision.cache_creation_tokens,
            cache_read: decision.cache_read_tokens,
          },
          duration_ms: Date.now() - sysStart,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron/cycle] system=${sys.id} error:`, msg);
        results.push({
          system_id: sys.id,
          ok: false,
          error: msg,
          duration_ms: Date.now() - sysStart,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      systems_processed: results.length,
      results,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/cycle] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg, results }, { status: 500 });
  }
}
