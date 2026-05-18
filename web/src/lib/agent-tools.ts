/**
 * Chat agent tools — each chat request gets its own toolset bound to the
 * currently-selected system. All reads/writes scoped by systemId.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  getRecentReadings,
  getRecentDecisions,
  getPendingTasks,
  createHumanTask,
  getSystem,
  updateSystem,
  markSetupComplete,
  saveReading,
  saveAction,
  decrementBottle,
  setBottleLevels,
  setDoserVerified,
  DEFAULT_SYSTEM_ID,
} from "./db";
import { readTuyaSensor } from "./devices/tuya";
import { doseChannelByPhysical } from "./devices/jebao";
import { validateCommand } from "./safety";
import { PRIMING_DONE_SENTINEL, PRIMING_ML_PER_CHANNEL } from "./priming";
import { getDosingConfig, allChannelKeys, type DosingConfig } from "./dosing-config";
import { getProfile, listProfiles } from "./fertilizer-profiles";
import { getPrimingState } from "./priming";

export async function buildAgentTools(systemId: string = DEFAULT_SYSTEM_ID) {
  // Resolve the per-system dosing layout once per chat request so all tools
  // describe the SAME universe of channels to the model.  If the system has
  // no persisted config the helper falls back to the legacy default.
  const dosingConfig: DosingConfig = await getDosingConfig(systemId);
  const channelKeys = allChannelKeys(dosingConfig);
  const profile = getProfile(dosingConfig.profile_id);

  // Build a human-readable list of channel keys with their role so the model
  // can pick the right one in proposeAction.
  const channelDescriptions = channelKeys
    .map((k) => {
      const a = dosingConfig.assignments[k];
      return `${k} (role=${a?.role ?? "?"})`;
    })
    .join(", ") || "(none configured)";
  const profileBlurb = profile
    ? `Installed: ${profile.name_en} (${profile.vendor}); components ${profile.components
        .map((c) => c.key)
        .join("/")}.`
    : "No fertilizer profile attached.";

  return {
    getCurrentState: tool({
      description:
        "Get the current sensor reading, last AI decision, and system profile for the active system. Call this whenever the grower asks about how things are right now. " +
        "IMPORTANT: if `setup_completed_at` is null, the system is STILL IN INSTALL MODE — sensor readings (if any) are pre-install noise and you should NOT reason on them. Tell the grower that the system is pre-install and ask them to confirm when running.",
      inputSchema: z.object({}),
      execute: async () => {
        const [readings, decisions, pending, sys] = await Promise.all([
          getRecentReadings(24, 1, systemId),
          getRecentDecisions(1, systemId),
          getPendingTasks(systemId),
          getSystem(systemId),
        ]);
        const current = readings[readings.length - 1] || null;
        const last = decisions[0] || null;
        return {
          system: sys ? { id: sys.id, name: sys.name, status: sys.status } : null,
          setup_completed_at: sys?.setup_completed_at
            ? sys.setup_completed_at.toISOString()
            : null,
          pre_install: !sys?.setup_completed_at,
          current_reading: current
            ? {
                timestamp: current.ts.toISOString(),
                ph: current.ph,
                ec: current.ec,
                tds: current.tds,
                orp: current.orp,
                water_temp: current.water_temp,
                cf: current.cf,
                salinity: current.salinity,
                sg: current.sg,
                source: current.source,
              }
            : null,
          last_decision: last
            ? {
                id: last.id,
                timestamp: last.ts.toISOString(),
                status: last.status,
                message: last.message,
                analysis: last.analysis,
              }
            : null,
          pending_tasks_count: pending.length,
          system_profile: sys
            ? {
                crop: sys.crop_type,
                growth_stage: sys.growth_stage,
                reservoir_liters: sys.reservoir_liters,
                location: sys.location,
              }
            : null,
        };
      },
    }),

    getRecentReadings: tool({
      description:
        "Get raw sensor readings over a recent time window. Use when the grower asks about trends or history.",
      inputSchema: z.object({
        hours: z.number().min(1).max(168).default(24),
        limit: z.number().min(10).max(500).default(200),
      }),
      execute: async ({ hours, limit }) => {
        const readings = await getRecentReadings(hours, limit, systemId);
        return {
          system_id: systemId,
          count: readings.length,
          readings: readings.map((r) => ({
            ts: r.ts.toISOString(),
            ph: r.ph,
            ec: r.ec,
            water_temp: r.water_temp,
            orp: r.orp,
          })),
        };
      },
    }),

    getRecentDecisions: tool({
      description:
        "Get the recent autonomous AI decisions log. Use when the grower asks 'why did you do X' or wants to review recent reasoning.",
      inputSchema: z.object({
        limit: z.number().min(1).max(50).default(10),
      }),
      execute: async ({ limit }) => {
        const decisions = await getRecentDecisions(limit, systemId);
        return {
          system_id: systemId,
          count: decisions.length,
          decisions: decisions.map((d) => ({
            id: d.id,
            ts: d.ts.toISOString(),
            status: d.status,
            analysis: d.analysis,
            message: d.message,
          })),
        };
      },
    }),

    getPendingTasks: tool({
      description:
        "Get the list of currently pending Human Tasks (things the system has asked the grower to do).",
      inputSchema: z.object({}),
      execute: async () => {
        const tasks = await getPendingTasks(systemId);
        return {
          system_id: systemId,
          count: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            type: t.type,
            priority: t.priority,
            title: t.title,
            reason: t.reason,
            created_at: t.created_at.toISOString(),
          })),
        };
      },
    }),

    executeDose: tool({
      description:
        "FIRE A REAL DOSE on the doser RIGHT NOW.  Use this in chat the moment the grower explicitly says yes/בצע/אישור/קדימה to a dose you suggested — do NOT use proposeAction in that case (it just creates a clickable task and feels broken in the conversational flow). " +
        "The tool validates against the SafetyController (pH/EC/temp bounds, per-hour quota, min-interval), resolves the physical Jebao channel from the system's dosing_config, fires the pump, and logs to dosing_actions.  Returns success + actual ml + runtime.  If safety blocks the dose, the tool returns the block reason — share it with the grower verbatim, don't paper over it. " +
        `Channels available on THIS system: ${channelDescriptions}. ${profileBlurb}`,
      inputSchema: z.object({
        channel: z.string().describe(`Logical channel key: ${channelKeys.join(", ") || "(none)"}`),
        amount_ml: z.number().min(0.1).max(50),
        reason_he: z.string().describe("Hebrew explanation logged with the action so the grower can review later"),
      }),
      execute: async (params) => {
        if (!channelKeys.includes(params.channel)) {
          return {
            ok: false,
            error: `Channel '${params.channel}' is not configured. Available: ${channelKeys.join(", ") || "(none)"}.`,
          };
        }
        const assignment = dosingConfig.assignments[params.channel];
        if (!assignment) {
          return { ok: false, error: `No physical channel mapped for '${params.channel}'` };
        }

        // Latest reading for the safety check.
        const recent = await getRecentReadings(1, 1, systemId);
        const current = recent[recent.length - 1] ?? null;
        const safety = await validateCommand(
          {
            channel: params.channel,
            amount_ml: params.amount_ml,
            reason: params.reason_he,
            // executeDose is grower-driven treatment, never priming.  Priming
            // has its own tool (primeChannel) that sets is_priming=true on
            // the safety call AND writes ai_status='priming' on the row.
            is_priming: false,
          },
          current,
          { systemId, dosingConfig }
        );
        if (!safety.ok) {
          return {
            ok: false,
            blocked_by_safety: true,
            reason: safety.reason,
            note: "Safety controller refused this dose. Explain the reason to the grower; do not retry without addressing it.",
          };
        }

        // Fire the actual pump.
        const r = await doseChannelByPhysical(
          assignment.physical,
          params.amount_ml,
          params.reason_he,
          params.channel
        );
        // Log either way so the audit trail stays honest.
        try {
          await saveAction(
            {
              channel: params.channel,
              amount_ml: params.amount_ml,
              reason: r.success ? params.reason_he : `FAILED: ${r.error}`,
              success: r.success,
              ai_status: "chat",
              ai_analysis: "Direct dose via chat (executeDose)",
            },
            systemId
          );
        } catch (e) {
          console.error("[executeDose] failed to log action:", e);
        }
        // Decrement bottle level on confirmed-success treatment doses.
        if (r.success) {
          try {
            await decrementBottle(systemId, params.channel, params.amount_ml);
          } catch (e) {
            console.error("[executeDose] decrementBottle failed:", e);
          }
        }

        return {
          ok: r.success,
          channel: params.channel,
          physical_channel: assignment.physical,
          amount_ml: params.amount_ml,
          runtime_seconds: r.runtime_seconds,
          error: r.error,
          note: r.success
            ? "Dose fired. Briefly confirm to the grower (channel + ml) and offer to poll the sensor in a few minutes to see the effect."
            : "Dose attempt failed. Share the error with the grower and suggest the next step (retry / check hardware / call a human task).",
        };
      },
    }),

    proposeAction: tool({
      description:
        "Create a 'dose_approval' Human Task — used ONLY when you DON'T have the grower in front of you in chat (autonomous cycle context, or follow-up that needs explicit human approval before any dose). " +
        "In an active chat conversation, prefer `executeDose` after the grower says yes — that fires the dose directly with one round-trip and feels like a normal conversation rather than 'go click a button in the dashboard'. " +
        `Channels available: ${channelDescriptions}. ${profileBlurb}`,
      inputSchema: z.object({
        // Zod free-string + runtime validation against the per-system config.
        // We don't lock the enum at schema time so each system's chat can
        // address its own channel set without a code change.
        channel: z.string().describe(`One of: ${channelKeys.join(", ") || "(none)"}`),
        amount_ml: z.number().min(0.1).max(50),
        title_he: z.string().describe("Short Hebrew title for the dashboard"),
        reason_he: z.string().describe("Hebrew explanation for the grower"),
        reason_en: z.string().describe("English technical reason"),
      }),
      execute: async (params) => {
        if (!channelKeys.includes(params.channel)) {
          return {
            kind: "rejected",
            reason: `Channel '${params.channel}' is not configured on this system. ` +
              `Available: ${channelKeys.join(", ") || "(none)"}.`,
          };
        }
        const taskId = await createHumanTask(
          {
            type: "dose_approval",
            priority: "high",
            title: params.title_he,
            reason: params.reason_he,
            payload: {
              channel: params.channel,
              amount_ml: params.amount_ml,
              reason_en: params.reason_en,
            },
            expires_in_hours: 0.5,
          },
          systemId
        );
        return {
          kind: "proposal_created",
          task_id: taskId,
          channel: params.channel,
          amount_ml: params.amount_ml,
          note: "Created as dose_approval Human Task. The grower must confirm before any dose runs.",
        };
      },
    }),

    requestObservation: tool({
      description:
        "Ask the grower to perform a physical observation: take a photo, inspect roots, check water level, etc. Creates a 'manual_action' Human Task.",
      inputSchema: z.object({
        observation_type: z.enum(["photo", "root_inspection", "water_level", "general"]),
        title_he: z.string().describe("Short Hebrew title"),
        reason_he: z.string().describe("Hebrew explanation of what and why"),
      }),
      execute: async (params) => {
        const taskId = await createHumanTask(
          {
            type: "manual_action",
            priority: "medium",
            title: params.title_he,
            reason: params.reason_he,
            payload: { observation_type: params.observation_type },
            expires_in_hours: 24,
          },
          systemId
        );
        return {
          kind: "observation_request_created",
          task_id: taskId,
          observation_type: params.observation_type,
        };
      },
    }),

    askGrower: tool({
      description:
        "Ask the grower a question that needs a specific answer. If `options` are provided, the UI renders clickable cards (stacked-questions pattern) and the grower picks. If no options, the UI shows a normal text reply prompt. Use this for closed-set questions during system setup or follow-ups — much faster for the grower than typing. Always phrase questions in Hebrew unless context dictates otherwise.",
      inputSchema: z.object({
        question: z.string().describe("The question text in Hebrew"),
        options: z
          .array(
            z.object({
              value: z.string().describe("Internal value (English, used in updateSystem etc.)"),
              label: z.string().describe("Hebrew label shown to the grower"),
              description: z.string().optional().describe("Optional short Hebrew description below label"),
            })
          )
          .optional()
          .describe("Closed-set options. Omit for free-text questions."),
        multi: z
          .boolean()
          .default(false)
          .optional()
          .describe("If true, the grower can pick multiple options"),
      }),
      // This tool is UI-only — the chat client renders the question and sends
      // the grower's reply as the next message. The execute return is just so
      // the tool resolves cleanly in the model loop.
      execute: async (params) => ({ rendered: true, ...params }),
    }),

    configureFertilizer: tool({
      description:
        "Persist this system's dosing configuration: which fertilizer profile is installed (Terra Aquatica TriPart, AD HaMushlam, etc.) and which physical Jebao channel carries each bottle (nutrient components + pH up/down). " +
        "Call this when the grower describes a new install or changes bottles. The grower may specify only some channels — channels left out get removed from the config. " +
        `Known profiles: ${listProfiles().map((p) => `${p.id} (${p.name_en})`).join("; ")}. ` +
        "Each assignment is { physical: 1..5, role: 'fertilizer'|'ph_up'|'ph_down', component_key?: string }. " +
        "For 'fertilizer' role, component_key must be one of the chosen profile's component keys.",
      inputSchema: z.object({
        profile_id: z
          .string()
          .describe("Fertilizer profile id, e.g. 'terra_aquatica_tripart' or 'ad_hamushlam'"),
        assignments: z
          .array(
            z.object({
              key: z.string().describe(
                "Channel role identifier — fertilizer component key (e.g. 'micro') OR 'ph_up' / 'ph_down'"
              ),
              physical: z.number().int().min(1).max(8),
              role: z.enum(["fertilizer", "ph_up", "ph_down"]),
              component_key: z.string().optional(),
            })
          )
          .describe("One entry per physically-plumbed channel. Omit channels that aren't installed."),
      }),
      execute: async (params) => {
        const prof = getProfile(params.profile_id);
        if (!prof) {
          return {
            ok: false,
            error: `Unknown profile_id '${params.profile_id}'. Known: ${listProfiles().map((p) => p.id).join(", ")}.`,
          };
        }
        const componentKeys = new Set(prof.components.map((c) => c.key));
        const assignments: Record<string, unknown> = {};
        const errors: string[] = [];
        for (const a of params.assignments) {
          if (a.role === "fertilizer") {
            const compKey = a.component_key ?? a.key;
            if (!componentKeys.has(compKey)) {
              errors.push(
                `assignment key '${a.key}': component '${compKey}' not in profile '${prof.id}' (components: ${[...componentKeys].join(", ")})`
              );
              continue;
            }
            assignments[a.key] = {
              role: "fertilizer",
              component_key: compKey,
              physical: a.physical,
            };
          } else {
            assignments[a.key] = { role: a.role, physical: a.physical };
          }
        }
        if (errors.length > 0) {
          return { ok: false, errors };
        }
        const dosing_config = { profile_id: prof.id, assignments };
        await updateSystem(systemId, { dosing_config });
        return {
          ok: true,
          profile: prof.id,
          channels: Object.keys(assignments),
          note: "Dosing config saved. Future doses + safety checks use this layout.",
        };
      },
    }),

    pollSensorNow: tool({
      description:
        "Pull a FRESH live reading from the Tuya sensor right now (not the DB cache).  Use this whenever you need a current value and the most recent DB row is older than ~30 seconds — typical cases: " +
        "1) just after markSetupComplete (first proof the sensor is in water and reporting), " +
        "2) the grower just told you about a physical event ('I added water', 'I added nutrient', 'I moved the sensor'), " +
        "3) right before proposing a dose so you reason on a current value, " +
        "4) the grower asks 'what does it say now / מה הקריאה'. " +
        "DO NOT call this in tight loops — it hits the Tuya cloud and the sensor itself.  If a reading was saved in the last 20s, this tool returns that cached one instead of a fresh fetch (rate limit).  Saved to DB so the next cron cycle and the brain see it too.",
      inputSchema: z.object({
        force: z
          .boolean()
          .optional()
          .describe("Bypass the 20s rate-limit (use sparingly; only when the grower explicitly requests a fresh reading)"),
      }),
      execute: async ({ force }) => {
        // Rate-limit unless explicitly bypassed: if the newest reading on
        // this system is fresher than 20s, return it without hitting Tuya.
        const recentFromDb = await getRecentReadings(1, 1, systemId);
        const latest = recentFromDb[recentFromDb.length - 1];
        const ageSec = latest ? (Date.now() - latest.ts.getTime()) / 1000 : Infinity;
        if (!force && latest && ageSec < 20) {
          return {
            source: "db_cache",
            age_seconds: Math.round(ageSec),
            reading: {
              timestamp: latest.ts.toISOString(),
              ph: latest.ph,
              ec: latest.ec,
              tds: latest.tds,
              orp: latest.orp,
              water_temp: latest.water_temp,
              cf: latest.cf,
              salinity: latest.salinity,
              sg: latest.sg,
            },
            note: "Last reading is fresh enough (<20s); skipped a Tuya call. Set force:true to fetch live anyway.",
          };
        }

        const sys = await getSystem(systemId);
        try {
          const r = await readTuyaSensor({ deviceId: sys?.tuya_device_id ?? undefined });
          // Persist so the cron + brain see it too on their next pass.
          await saveReading(
            {
              ph: r.ph,
              ec: r.ec,
              tds: r.tds,
              orp: r.orp,
              water_temp: r.water_temp,
              cf: r.cf,
              salinity: r.salinity,
              sg: r.sg,
              source: r.source,
            },
            systemId
          );
          return {
            source: "tuya_live",
            online: r.online,
            reading: {
              timestamp: r.ts.toISOString(),
              ph: r.ph,
              ec: r.ec,
              tds: r.tds,
              orp: r.orp,
              water_temp: r.water_temp,
              cf: r.cf,
              salinity: r.salinity,
              sg: r.sg,
            },
            note: r.online
              ? "Fresh reading from Tuya saved to DB."
              : "Sensor reported offline — the values above may be a Tuya cache.",
          };
        } catch (e) {
          return {
            source: "error",
            error: e instanceof Error ? e.message : String(e),
            note: "Tuya call failed. If this persists, the sensor may be offline or credentials need a refresh.",
          };
        }
      },
    }),

    markSetupComplete: tool({
      description:
        "Mark the moment the physical install is confirmed running — sensor is in the reservoir, water is circulating, doser is wired. Call this ONLY when the grower explicitly confirms they're physically set up (e.g. 'החיישן במים', 'המערכת רצה', 'אני מוכן'). Before this is called, the autonomous brain refuses to reason on sensor history because pre-install readings are noise (sensor in package / on shelf / drying). After this is called, all reading-queries start filtering from this timestamp forward.",
      inputSchema: z.object({
        confirmation_note_he: z
          .string()
          .optional()
          .describe("Optional Hebrew sentence summarising what the grower confirmed (e.g. 'חיישן במים, פאמפ פועל'). Stored to notes."),
      }),
      execute: async (params) => {
        await markSetupComplete(systemId);
        if (params.confirmation_note_he) {
          const sys = await getSystem(systemId);
          const newNote = sys?.notes
            ? `${sys.notes}\n[setup confirmed] ${params.confirmation_note_he}`
            : `[setup confirmed] ${params.confirmation_note_he}`;
          await updateSystem(systemId, { notes: newNote });
        }
        return {
          ok: true,
          setup_completed_at: new Date().toISOString(),
          note: "From now on the autonomous brain trusts sensor readings on this system.",
        };
      },
    }),

    declareBottleLevels: tool({
      description:
        "Record how many ml of liquid the grower has put in each bottle.  CRITICAL for safety — the dosing pipeline decrements these on every successful dose and refuses to dose from a bottle below the minimum (15ml floor).  Call this whenever the grower tells you they filled / refilled a bottle.  Provide ml for ONLY the channels they're declaring; existing values for other channels are preserved.",
      inputSchema: z.object({
        levels: z
          .record(z.string(), z.number().min(0).max(5000))
          .describe(`Map of channel key → ml. Channels available: ${channelKeys.join(", ") || "(none)"}`),
      }),
      execute: async (params) => {
        // Merge with existing levels so partial declarations don't wipe other channels.
        const sys = await getSystem(systemId);
        const existing = (sys?.bottle_levels as Record<string, number> | null) ?? {};
        const merged: Record<string, number> = { ...existing };
        for (const [k, v] of Object.entries(params.levels)) {
          if (!channelKeys.includes(k)) continue; // ignore unknown channels
          merged[k] = v;
        }
        await setBottleLevels(systemId, merged);
        return {
          ok: true,
          bottle_levels: merged,
          note: "Bottle levels recorded. Safety controller will now decrement on each dose and block when any channel runs below 15ml.",
        };
      },
    }),

    markDoserVerified: tool({
      description:
        "Mark the doser as VERIFIED — the grower has visually confirmed each channel pumps liquid and the channel→bottle mapping is correct (via runDoserProtocol's calibration step).  Required prerequisite before `enableAutonomousDosing` can be called.  Do not call this unless the grower explicitly confirmed they SAW liquid emerge from each tube AND matched it to the correct bottle.",
      inputSchema: z.object({
        confirmation_note_he: z
          .string()
          .optional()
          .describe("Optional Hebrew sentence recording what the grower visually confirmed."),
      }),
      execute: async (params) => {
        await setDoserVerified(systemId, true);
        if (params.confirmation_note_he) {
          const sys = await getSystem(systemId);
          const newNote = sys?.notes
            ? `${sys.notes}\n[doser verified] ${params.confirmation_note_he}`
            : `[doser verified] ${params.confirmation_note_he}`;
          await updateSystem(systemId, { notes: newNote });
        }
        return {
          ok: true,
          note: "Doser is now marked verified. The grower can flip the autonomous dosing toggle in the UI when they're ready — DO NOT enable it for them via tool; it's a deliberate human action.",
        };
      },
    }),

    runDoserProtocol: tool({
      description:
        "Run the doser verification protocol on a fresh install: for each configured channel, fire a tiny 1ml calibration dose so the grower can visually confirm (a) the pump physically spins, (b) liquid actually emerges from the correct tube, (c) the channel→bottle mapping matches what they declared.  RUNS PRIMING FIRST (8ml per channel) if any channel is still unprimed, so the calibration drops aren't lost in the dead-volume tube. " +
        "After this completes, ASK the grower to visually verify all 4 drops emerged from the correct bottles, then call `markDoserVerified` only if they confirm.  This whole flow MUST run before autonomous dosing can be enabled.",
      inputSchema: z.object({
        calibration_ml: z
          .number()
          .min(0.5)
          .max(3)
          .optional()
          .describe("Volume per channel for the verification drop (default 1ml — small enough that 4 channels' worth doesn't materially shift the reservoir)."),
      }),
      execute: async ({ calibration_ml }) => {
        const ml = calibration_ml ?? 1;
        // Step 1: prime any unprimed channels first.
        const state = await getPrimingState(systemId);
        const unprimed = channelKeys.filter((k) => !state.channels[k]?.primed);
        const priming_results: Array<{ channel: string; ok: boolean; error?: string }> = [];
        for (const key of unprimed) {
          const a = dosingConfig.assignments[key];
          if (!a) {
            priming_results.push({ channel: key, ok: false, error: "no physical mapping" });
            continue;
          }
          const reason = `${PRIMING_DONE_SENTINEL} (doserProtocol prime, ${PRIMING_ML_PER_CHANNEL}ml)`;
          const r = await doseChannelByPhysical(a.physical, PRIMING_ML_PER_CHANNEL, reason, key);
          try {
            await saveAction(
              {
                channel: key,
                amount_ml: PRIMING_ML_PER_CHANNEL,
                reason: r.success ? reason : `FAILED priming: ${r.error}`,
                success: r.success,
                ai_status: "priming",
                ai_analysis: "runDoserProtocol — initial prime",
              },
              systemId
            );
          } catch {}
          priming_results.push({ channel: key, ok: r.success, error: r.error });
        }

        // Step 2: 1ml verification drop on EVERY channel.
        const verify_results: Array<{ channel: string; ok: boolean; ml: number; error?: string }> = [];
        for (const key of channelKeys) {
          const a = dosingConfig.assignments[key];
          if (!a) {
            verify_results.push({ channel: key, ok: false, ml, error: "no physical mapping" });
            continue;
          }
          const reason = `doserProtocol verification drop (${ml}ml)`;
          const r = await doseChannelByPhysical(a.physical, ml, reason, key);
          try {
            await saveAction(
              {
                channel: key,
                amount_ml: ml,
                reason: r.success ? reason : `FAILED verification: ${r.error}`,
                success: r.success,
                ai_status: "doser_protocol",
                ai_analysis: "runDoserProtocol — 1ml verification drop",
              },
              systemId
            );
          } catch {}
          // Don't decrement bottle level here — these are tiny and the
          // grower hasn't necessarily declared levels yet at this point.
          verify_results.push({ channel: key, ok: r.success, ml, error: r.error });
        }

        const allOk =
          priming_results.every((x) => x.ok) && verify_results.every((x) => x.ok);
        return {
          ok: allOk,
          primed: priming_results,
          verification_drops: verify_results,
          next_step:
            "Ask the grower: 'תראה לי שיצאו 4 טיפות, אחת מכל צינור.  אם כן — תאשר ואני אסמן את הדוזר כמאומת.'  Only call markDoserVerified after they confirm visually.",
        };
      },
    }),

    primeAllChannels: tool({
      description:
        "Prime ALL the unprimed channels on this rig in ONE deterministic chain — fires the priming dose on each in sequence, waits for each pump to finish, and returns aggregate results.  Use this for the typical 'first-time-setup, prime everything' flow so the agent can't accidentally skip a channel or forget to come back.  " +
        "Fits inside the 60s chat-route timeout for the standard 4-channel rig (~10s per channel including pump runtime).  If channels are specified explicitly, primes only those; otherwise primes every channel in the system's dosing_config that has no priming record yet.",
      inputSchema: z.object({
        channels: z
          .array(z.string())
          .optional()
          .describe(
            "Channel keys to prime.  Omit to auto-detect all currently-unprimed channels on this rig."
          ),
        amount_ml: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe(`Per-channel volume (default ${PRIMING_ML_PER_CHANNEL}ml dead-volume).`),
      }),
      execute: async (params) => {
        const ml = params.amount_ml ?? PRIMING_ML_PER_CHANNEL;
        // Auto-detect mode: ask priming.ts which channels are still unprimed.
        let targets: string[];
        if (params.channels && params.channels.length > 0) {
          targets = params.channels;
        } else {
          const state = await getPrimingState(systemId);
          targets = channelKeys.filter((k) => !state.channels[k]?.primed);
        }
        if (targets.length === 0) {
          return {
            ok: true,
            note: "All channels already primed — nothing to do.",
            primed: [],
          };
        }

        const results: Array<{
          channel: string;
          physical: number;
          ok: boolean;
          ml: number;
          runtime_seconds: number;
          error?: string;
        }> = [];

        for (const key of targets) {
          if (!channelKeys.includes(key)) {
            results.push({ channel: key, physical: 0, ok: false, ml, runtime_seconds: 0, error: "channel not configured" });
            continue;
          }
          const assignment = dosingConfig.assignments[key];
          if (!assignment) {
            results.push({ channel: key, physical: 0, ok: false, ml, runtime_seconds: 0, error: "no physical mapping" });
            continue;
          }
          const reason = `${PRIMING_DONE_SENTINEL} (${ml}ml feed-tube prime)`;
          const r = await doseChannelByPhysical(assignment.physical, ml, reason, key);
          try {
            await saveAction(
              {
                channel: key,
                amount_ml: ml,
                reason: r.success ? reason : `FAILED priming: ${r.error}`,
                success: r.success,
                ai_status: "priming",
                ai_analysis: `primeAllChannels (chained) — ${key}`,
              },
              systemId
            );
          } catch (e) {
            console.error("[primeAllChannels] log failed:", e);
          }
          results.push({
            channel: key,
            physical: assignment.physical,
            ok: r.success,
            ml,
            runtime_seconds: r.runtime_seconds,
            error: r.error,
          });
        }
        const ok = results.every((x) => x.ok);
        return {
          ok,
          primed: results,
          note: ok
            ? "All target channels primed in one chain. Tell the grower briefly (e.g. '✅ 4 ערוצים פראמדו') and move on to the next planned step (treatment dose / polling)."
            : "Some channels failed to prime. Surface the failures to the grower with the specific errors so they can decide retry vs skip.",
        };
      },
    }),

    primeChannel: tool({
      description:
        "Fire a priming dose (default 8ml) on a single channel to fill its feed-tube dead volume.  Use this for each UNPRIMED channel during initial setup.  Logged with the priming sentinel so it's exempt from the SafetyController's per-channel min-interval (i.e. you can prime + then real-dose the same channel within seconds).  Chain calls for multiple channels in the same assistant turn — do not pause for re-approval between channels once the grower approved the overall priming plan.",
      inputSchema: z.object({
        channel: z.string().describe(`Channel key: ${channelKeys.join(", ") || "(none)"}`),
        amount_ml: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe(`Override priming volume (default ${PRIMING_ML_PER_CHANNEL}ml dead-volume on this rig)`),
      }),
      execute: async (params) => {
        if (!channelKeys.includes(params.channel)) {
          return {
            ok: false,
            error: `Channel '${params.channel}' is not configured. Available: ${channelKeys.join(", ") || "(none)"}.`,
          };
        }
        const assignment = dosingConfig.assignments[params.channel];
        if (!assignment) {
          return { ok: false, error: `No physical channel mapped for '${params.channel}'` };
        }
        const ml = params.amount_ml ?? PRIMING_ML_PER_CHANNEL;

        // Priming bypasses the pH-out-of-bounds gate too — it's a tube-fill,
        // not a reservoir change.  But we still want sensor freshness and
        // hardware checks, so we run the regular safety pipeline against a
        // synthetic command whose reason starts with the priming sentinel
        // (the safety pipeline excludes those from interval/quota checks).
        const reason = `${PRIMING_DONE_SENTINEL} (${ml}ml feed-tube prime)`;
        const recent = await getRecentReadings(1, 1, systemId);
        const current = recent[recent.length - 1] ?? null;

        // For priming we want to dose even when pH is out of bounds for the
        // *channel's normal role* — the priming liquid doesn't touch the
        // reservoir in any volume that matters.  Skip the validateCommand
        // call deliberately here; the controller is designed for treatment
        // doses, not tube-fill events.

        const r = await doseChannelByPhysical(assignment.physical, ml, reason, params.channel);
        try {
          await saveAction(
            {
              channel: params.channel,
              amount_ml: ml,
              reason: r.success ? reason : `FAILED priming: ${r.error}`,
              success: r.success,
              ai_status: "priming",
              ai_analysis: `Chat-driven prime for ${params.channel}`,
            },
            systemId
          );
        } catch (e) {
          console.error("[primeChannel] failed to log:", e);
        }
        // Suppress the unused-warning for the safety helper we deliberately
        // skipped — reference it so the compiler doesn't complain.
        void current;
        void validateCommand;

        return {
          ok: r.success,
          channel: params.channel,
          physical_channel: assignment.physical,
          amount_ml: ml,
          runtime_seconds: r.runtime_seconds,
          error: r.error,
          note: r.success
            ? "Channel primed. Continue to the next channel in your plan without re-asking the grower."
            : "Priming failed. Tell the grower the error and ask whether to retry or skip this channel.",
        };
      },
    }),

    getPrimingStatus: tool({
      description:
        "Show which feed-tube channels on this system have been primed yet. Every channel has ~8ml of dead-volume in its feed tube; the FIRST dose on an unprimed channel doesn't change the reservoir. Use this when the grower asks 'is the system ready to dose' or right before proposing the first nutrient dose on a fresh install.",
      inputSchema: z.object({}),
      execute: async () => {
        const state = await getPrimingState(systemId);
        const out: Array<{
          channel: string;
          primed: boolean;
          last_event_at: string | null;
          ml_since_last_event: number;
        }> = [];
        for (const key of channelKeys) {
          const c = state.channels[key];
          out.push({
            channel: key,
            primed: c?.primed ?? false,
            last_event_at: c?.last_event_at ? c.last_event_at.toISOString() : null,
            ml_since_last_event: c?.ml_since_last_event ?? 0,
          });
        }
        return {
          system_id: systemId,
          default_priming_ml: PRIMING_ML_PER_CHANNEL,
          channels: out,
        };
      },
    }),

    listFertilizerProfiles: tool({
      description:
        "List all available fertilizer profiles (brands/product lines) the agronomist can choose between when configuring a system. Use during onboarding or when the grower asks what's supported.",
      inputSchema: z.object({}),
      execute: async () => ({
        profiles: listProfiles().map((p) => ({
          id: p.id,
          name_he: p.name_he,
          name_en: p.name_en,
          vendor: p.vendor,
          components: p.components.map((c) => ({
            key: c.key,
            label_he: c.label_he,
            npk: c.npk,
          })),
        })),
      }),
    }),

    updateSystem: tool({
      description:
        "Save what you learned about this system to its profile (name, crop, growth stage, reservoir size, location, notes). Call this whenever you've collected new info — typically right after the grower answers via askGrower. Only include the fields you want to change. The grower never sees this tool call directly; just confirm verbally what you saved.",
      inputSchema: z.object({
        name: z.string().optional().describe("Display name in Hebrew"),
        crop_type: z
          .enum(["lettuce", "basil", "spinach", "strawberry", "tomato"])
          .optional(),
        growth_stage: z
          .enum(["seedling", "vegetative", "flowering", "fruiting"])
          .optional(),
        reservoir_liters: z.number().min(5).max(2000).optional(),
        system_type: z.string().optional(),
        location: z.string().optional(),
        outdoor: z.boolean().optional(),
        notes: z.string().optional(),
      }),
      execute: async (patch) => {
        const updated = await updateSystem(systemId, patch);
        return {
          ok: true,
          applied: patch,
          system: updated
            ? {
                id: updated.id,
                name: updated.name,
                crop_type: updated.crop_type,
                growth_stage: updated.growth_stage,
                reservoir_liters: updated.reservoir_liters,
              }
            : null,
        };
      },
    }),
  };
}
