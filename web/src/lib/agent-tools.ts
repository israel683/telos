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
  DEFAULT_SYSTEM_ID,
} from "./db";

export function buildAgentTools(systemId: string = DEFAULT_SYSTEM_ID) {
  return {
    getCurrentState: tool({
      description:
        "Get the current sensor reading, last AI decision, and system profile for the active system. Call this whenever the grower asks about how things are right now.",
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
        "Propose a dosing action by creating a 'dose_approval' Human Task for the grower to confirm. This does NOT execute the dose. Use when, based on the data, you'd recommend dosing but want explicit human approval first. Channels reflect the Terra Aquatica Tri Part setup: micro/grow/bloom (NPK) + ph_up. There is NO pH Down channel — high pH must go through a manual_action human task instead.",
      inputSchema: z.object({
        channel: z.enum(["micro", "grow", "bloom", "ph_up"]),
        amount_ml: z.number().min(0.1).max(50),
        title_he: z.string().describe("Short Hebrew title for the dashboard"),
        reason_he: z.string().describe("Hebrew explanation for the grower"),
        reason_en: z.string().describe("English technical reason"),
      }),
      execute: async (params) => {
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
