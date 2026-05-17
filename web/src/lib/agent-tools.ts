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
  DEFAULT_SYSTEM_ID,
} from "./db";
import { readTuyaSensor } from "./devices/tuya";
import { getDosingConfig, allChannelKeys, type DosingConfig } from "./dosing-config";
import { getProfile, listProfiles } from "./fertilizer-profiles";
import { getPrimingState, PRIMING_ML_PER_CHANNEL } from "./priming";

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

    proposeAction: tool({
      description:
        "Propose a dosing action by creating a 'dose_approval' Human Task for the grower to confirm. This does NOT execute the dose. Use when, based on the data, you'd recommend dosing but want explicit human approval first. " +
        `Channels available on THIS system: ${channelDescriptions}. ${profileBlurb} ` +
        "Channels not listed here do not exist on this rig — for missing pH directions or missing components, raise a manual_action human task instead.",
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
