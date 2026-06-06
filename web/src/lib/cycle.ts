/**
 * runSystemCycle — the ONE re-derivation path for a system's Brain state.
 *
 * Both the scheduled cron (`/api/cron/cycle`) and grower actions (confirming a
 * dose, answering a question) call this. That is the synchronisation contract:
 * the displayed "Brain analysis" (the latest `ai_decisions` row), the pushed
 * chat message, the episodic memory line, and any new Human Tasks are all
 * PRODUCED here. So when the grower does something — doses by hand, answers a
 * question — we re-run this immediately and every surface re-derives from the
 * fresh decision instead of showing a snapshot from the last 2-hour tick.
 *
 *   - source 'cron'   → scheduled tick; honours the cycle gate (skip cheap
 *                       ticks, suppress chat noise).
 *   - force: true     → grower-triggered; bypass the gate (the world just
 *                       materially changed) and always re-analyse.
 *   - forcePush: true → always push a chat message (a grower action deserves
 *                       an acknowledgement, even if status is unchanged).
 *
 * Returns a per-system result record for the cron's response array.
 */
import {
  getRecentReadings,
  getRecentActions,
  getPendingTasks,
  getRecentDecisions,
  saveDecision,
  saveAction,
  createHumanTask,
  expireOldTasks,
  saveChatMessage,
  setNextCheckAt,
  decrementBottle,
  getLastCronChatPush,
  addEpisode,
  hasRecentTaskOfType,
  getSystem,
  type SystemRow,
} from "@/lib/db";
import { analyzeAndDecide } from "@/lib/brain";
import { doseChannelByPhysical } from "@/lib/devices/jebao";
import { getDosingConfig } from "@/lib/dosing-config";
import { evaluateCycleGate } from "@/lib/cycle-gate";
import { getEffectiveTargets } from "@/lib/tolerance";
import { sendAlertEmail } from "@/lib/notify";

/**
 * How often the agent does a PROACTIVE REVIEW when everything is calm + healthy
 * (minutes until next re-engagement). Stage-aware: sensitive stages get a
 * tighter cadence (~3–4×/day) so the agent actively steers; the stable
 * workhorse stages relax (~1–2×/day) to stay lean on compute. Drift / critical
 * / out-of-band events bypass this entirely (the gate wakes immediately).
 */
function proactiveReviewMinutes(stage: string | null | undefined): number {
  switch (stage) {
    case "seedling":
      return 360; // ~4×/day — fragile establishment, watch closely
    case "flowering":
      return 360; // ~4×/day — flowering/bolting is decisive (esp. herbs)
    case "vegetative":
      return 720; // ~2×/day — stable, productive workhorse
    case "fruiting":
      return 480; // ~3×/day — sizing/ripening rewards attention
    default:
      return 720; // ~2×/day
  }
}

export type RunCycleOptions = {
  /** Bypass the cycle gate and always run the LLM (grower-triggered re-eval). */
  force?: boolean;
  /** Always push a chat message regardless of the suppression heuristics. */
  forcePush?: boolean;
  /** Tag for the chat message + logs: 'cron', 'grower-dose', 'grower-answer'… */
  source?: string;
  /**
   * Suppress creating NEW `question` Human Tasks this run. Used by the
   * grower-action re-eval: the grower just engaged (answered / dosed), so we
   * don't want the immediate re-analysis to turn around and re-interrogate them
   * — which is exactly how an answered question "reappears". The next scheduled
   * cron can still raise it if it's genuinely still needed.
   */
  suppressNewQuestions?: boolean;
};

/**
 * Grower-action entry point: re-derive a system's Brain state immediately
 * after a grower does something material (confirms a dose, answers a
 * question). Fetches the system, runs a forced cycle that always re-analyses
 * and always pushes a chat acknowledgement. Best-effort — never throws, so it
 * can't break the action's own success response. Returns the cycle result, or
 * null if it couldn't run.
 */
export async function reevalSystem(
  systemId: string,
  source: string
): Promise<Record<string, unknown> | null> {
  try {
    const sys = await getSystem(systemId);
    // Only re-evaluate live systems — a paused/archived rig shouldn't churn.
    if (!sys || sys.status !== "active") return null;
    return await runSystemCycle(sys, { force: true, forcePush: true, source, suppressNewQuestions: true });
  } catch (e) {
    console.error(`[cycle] reevalSystem(${systemId}, ${source}) failed:`, e);
    return null;
  }
}

export async function runSystemCycle(
  sys: SystemRow,
  opts: RunCycleOptions = {}
): Promise<Record<string, unknown>> {
  const { force = false, forcePush = false, source = "cron", suppressNewQuestions = false } = opts;
  const chatSource: "cron-cycle" | "reeval" = source === "cron" ? "cron-cycle" : "reeval";
  const sysStart = Date.now();

  await expireOldTasks(sys.id);
  const recent = await getRecentReadings(24, 500, sys.id);
  if (recent.length === 0) {
    return { system_id: sys.id, ok: false, skipped: "no readings yet" };
  }
  const current = recent[recent.length - 1];
  const recentActions = await getRecentActions(24, sys.id);
  const pendingTasks = await getPendingTasks(sys.id);

  // -------------------------------------------------------------------
  // Cycle gate — decide whether this tick is worth a Claude call.
  // A forced (grower-triggered) re-eval skips the gate entirely: the
  // world just changed under our feet, so we always re-analyse.
  // -------------------------------------------------------------------
  if (!force) {
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
      return {
        system_id: sys.id,
        ok: true,
        skipped: true,
        skip_reason: gate.skip_reason,
        decision_id: skipDecisionId,
        next_check_at: nextAt.toISOString(),
        duration_ms: Date.now() - sysStart,
      };
    }
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

  // Dedup human-task creation. Without this, every cycle (incl. the forced
  // re-eval right after a grower answers) re-creates the same question /
  // manual_action, so an answered question immediately "reappears" and the
  // grower is nagged with duplicates. Skip a type if one is already pending or
  // was raised/resolved within its window (the documented doctrine, finally
  // wired into this loop — dose_approval is deduped on its own path below).
  const TASK_DEDUP_HOURS: Record<string, number> = {
    question: 4,
    manual_action: 6,
    water_change: 6,
    system_reset: 6,
  };
  const createdTasks: typeof decision.human_tasks = [];
  for (const t of decision.human_tasks) {
    // A grower-action re-eval must not re-interrogate the grower they just
    // engaged with — this is what made an answered question "reappear".
    if (t.type === "question" && suppressNewQuestions) {
      console.log(`[cycle] system=${sys.id} suppressed new question on ${source} re-eval ("${t.title}")`);
      continue;
    }
    const windowH = TASK_DEDUP_HOURS[t.type] ?? 4;
    if (await hasRecentTaskOfType(t.type, windowH, sys.id)) {
      console.log(`[cycle] system=${sys.id} skipped duplicate ${t.type} task ("${t.title}") — recent/pending within ${windowH}h`);
      continue;
    }
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
    createdTasks.push(t);
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
    // Surface the Brain's proposed doses to the grower as dose_approval
    // tasks — using `proposed_doses` (every dose it recommended), NOT just
    // the safety-approved `commands`. Under manual dosing the grower acts
    // by hand, so a dose the autonomous caps blocked is still a valid
    // recommendation that MUST reach them — not vanish silently. Guard
    // against re-spawning every 2h: skip if a dose_approval is already
    // pending or was raised in the last 3h.  (This same guard is what
    // stops a grower-triggered re-eval from immediately re-nagging the
    // dose the grower just confirmed.)
    const dupePending = await hasRecentTaskOfType("dose_approval", 3, sys.id);
    for (const cmd of decision.proposed_doses) {
      if (!dupePending) {
        try {
          await createHumanTask(
            {
              type: "dose_approval",
              priority: "high",
              title: `אישור מנה: ${cmd.channel} ${cmd.amount_ml}ml`,
              reason:
                `המוח ממליץ ${cmd.amount_ml}ml ב-${cmd.channel}. ` +
                `הסיבה: ${cmd.reason}. דישון מתבצע ידנית — בצע/י את המנה ואז סמן/י "בוצע", או "בטל" אם לא רלוונטי.`,
              payload: {
                channel: cmd.channel,
                amount_ml: cmd.amount_ml,
                reason_en: cmd.reason,
                source: source === "cron" ? "cron-cycle-manual-dosing" : `reeval-${source}-manual-dosing`,
              },
              expires_in_hours: 8,
              decision_id: decisionId,
            },
            sys.id
          );
        } catch (e) {
          console.error(`[cycle] failed to create dose_approval task: ${e}`);
        }
      }
      executed.push({
        channel: cmd.channel,
        amount_ml: cmd.amount_ml,
        success: false,
        error: dupePending
          ? "manual dosing — dose_approval already pending/recent"
          : "manual dosing — recommendation queued as dose_approval task",
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
          console.error(`[cycle] decrementBottle failed: ${e}`);
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
    createdTasks.length > 0;
  if (noteworthy) {
    // Hebrew suffix — this summary surfaces to the grower (Grow hero / activity),
    // so keep it in the Brain's language, not an English log tag.
    const actionText =
      successes.length > 0
        ? ` · בוצע דישון: ${successes.map((e) => `${e.channel} ${e.amount_ml}ml`).join(", ")}`
        : executed.length > 0
        ? ` · הוצעו ${executed.length} מנות (ממתינות לאישור)`
        : createdTasks.length > 0
        ? ` · נוצרו ${createdTasks.length} משימות`
        : "";
    const base = (decision.message || decision.analysis || "cycle").slice(0, 220);
    try {
      await addEpisode(sys.id, {
        status: decision.status,
        summary: `${base}${actionText}`,
        decision_id: decisionId,
      });
    } catch (e) {
      console.error(`[cycle] addEpisode failed: ${e}`);
    }
  }

  // Re-engagement cadence.
  //  - Not healthy, OR acted this cycle (dosed / queued / raised a task): honour
  //    Claude's short next_check so it follows through promptly.
  //  - Calm + healthy + nothing to do: this was a PROACTIVE REVIEW. Re-engage on
  //    a STAGE-AWARE cadence — more often in sensitive stages, less often in the
  //    stable workhorse stages — so the agent keeps actively steering toward the
  //    cultivar's potential without burning compute every 2h. (This replaces the
  //    old flat min_skip floor that, combined with the in-band gate, made the
  //    agent passive: it only ever "woke" on drift.)
  const claudeMin = Number(decision.next_check_minutes) || 60;
  const actedThisCycle = executed.length > 0 || createdTasks.length > 0;
  const nextMin =
    decision.status !== "healthy" || actedThisCycle
      ? claudeMin
      : proactiveReviewMinutes(sys.growth_stage);
  await setNextCheckAt(sys.id, new Date(Date.now() + nextMin * 60_000));

  // Chat-push suppression — the v0.3 POC chat history showed the
  // brain spamming "pH is high" every 2 hours for 3 days while the
  // grower already had a pending task.  Push ONLY when the situation
  // materially changed:
  //   1. status changed from last push (transition)
  //   2. new human task was created this cycle
  //   3. a real dose actually fired this cycle
  //   4. periodic alive-check: last push was 8h+ ago, regardless
  //   5. forcePush — a grower action triggered this; acknowledge it.
  const lastPush = await getLastCronChatPush(sys.id);
  const statusChanged = lastPush?.status !== decision.status;
  const newTaskCreated = createdTasks.length > 0;
  const dosesFired = executed.some((e) => e.success);
  const lastPushAgeHours = lastPush
    ? (Date.now() - lastPush.ts.getTime()) / (60 * 60 * 1000)
    : Infinity;
  const periodicCheckIn = lastPushAgeHours >= 8;

  const shouldPush =
    forcePush || statusChanged || newTaskCreated || dosesFired || periodicCheckIn;

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
        source: chatSource,
        decisionId,
        status: decision.status,
      });
    } catch (e) {
      console.error("[cycle] failed to push chat message:", e);
    }
  } else {
    console.log(
      `[cycle] system=${sys.id} chat push suppressed ` +
        `(status='${decision.status}' unchanged since ${lastPushAgeHours.toFixed(1)}h ago, ` +
        `no new tasks, no doses fired)`
    );
  }

  // -------------------------------------------------------------------
  // Out-of-app URGENT alert (email) — the channel that reaches a grower who
  // isn't in the app. Scheduled cron only (a grower-triggered re-eval means
  // they're already here). Fire only on a material escalation so we don't
  // spam: status transitioned into warning/critical, a high/urgent task was
  // raised, or a dose was newly queued for the grower to perform by hand.
  // The change-based conditions self-dedupe (a steady-state critical doesn't
  // re-email every cycle).
  // -------------------------------------------------------------------
  if (source === "cron") {
    const escalated =
      statusChanged && (decision.status === "warning" || decision.status === "critical");
    const newHighTask = createdTasks.some(
      (t) => t.priority === "high" || t.priority === "urgent"
    );
    const newDoseApproval = executed.some(
      (e) => !e.success && typeof e.error === "string" && e.error.includes("queued as dose_approval")
    );
    if (escalated || newHighTask || newDoseApproval) {
      const lines: string[] = [decision.message || decision.analysis || "התראת מערכת"];
      if (newDoseApproval) {
        const doses = executed
          .filter((e) => !e.success && typeof e.error === "string" && e.error.includes("queued as dose_approval"))
          .map((e) => `${e.channel} ${e.amount_ml}ml`);
        if (doses.length) lines.push(`\nמנה לביצוע ידני: ${doses.join(", ")}`);
      }
      const newTasks = createdTasks.filter(
        (t) => t.priority === "high" || t.priority === "urgent"
      );
      if (newTasks.length) lines.push(`\nמשימות: ${newTasks.map((t) => t.title).join(" · ")}`);
      lines.push("\nפתח את TELOS כדי לפעול.");
      const subject = `TELOS · ${decision.status === "critical" ? "🔴 קריטי" : decision.status === "warning" ? "⚠ אזהרה" : "פעולה נדרשת"} — ${sys.name}`;
      const mail = await sendAlertEmail(subject, lines.join("\n"));
      if (!mail.ok && !("skipped" in mail && mail.skipped)) {
        console.error(`[cycle] urgent email failed for system=${sys.id}`);
      }
    }
  }

  return {
    system_id: sys.id,
    ok: true,
    decision_id: decisionId,
    status: decision.status,
    commands_executed: executed,
    blocked: decision.blocked_commands,
    tasks_created: createdTasks.length,
    next_check_minutes: decision.next_check_minutes,
    source,
    tokens: {
      input: decision.tokens_input,
      output: decision.tokens_output,
      cache_create: decision.cache_creation_tokens,
      cache_read: decision.cache_read_tokens,
    },
    duration_ms: Date.now() - sysStart,
  };
}
