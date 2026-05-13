/**
 * Chat agent tools — all read directly from the same Neon DB the cron jobs
 * write to. No external Railway/agent calls anymore (single-platform).
 */
import { tool } from "ai";
import { z } from "zod";
import {
  getRecentReadings,
  getRecentDecisions,
  getPendingTasks,
  createHumanTask,
  SYSTEM_ID,
} from "./db";

export const agentTools = {
  getCurrentState: tool({
    description:
      "Get the current sensor reading, last AI decision, system profile, and pending task counts. Call this whenever the grower asks about how things are right now.",
    inputSchema: z.object({}),
    execute: async () => {
      const [readings, decisions, pending] = await Promise.all([
        getRecentReadings(24, 1),
        getRecentDecisions(1),
        getPendingTasks(),
      ]);
      const current = readings[readings.length - 1] || null;
      const last = decisions[0] || null;
      return {
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
        system_id: SYSTEM_ID,
        system_profile: {
          crop: process.env.CROP_TYPE || "lettuce",
          reservoir_liters: Number(process.env.RESERVOIR_LITERS || 60),
          location: process.env.LOCATION || "Tel Aviv, Israel",
        },
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
      const readings = await getRecentReadings(hours, limit);
      return {
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
      const decisions = await getRecentDecisions(limit);
      return {
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
      const tasks = await getPendingTasks();
      return {
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
      "Propose a dosing action by creating a 'dose_approval' Human Task for the grower to confirm. This does NOT execute the dose. Use when, based on the data, you'd recommend dosing but want explicit human approval first.",
    inputSchema: z.object({
      channel: z.enum(["nutrient_a", "nutrient_b", "ph_up", "ph_down", "supplement"]),
      amount_ml: z.number().min(0.1).max(50),
      title_he: z.string().describe("Short Hebrew title for the dashboard"),
      reason_he: z.string().describe("Hebrew explanation for the grower"),
      reason_en: z.string().describe("English technical reason"),
    }),
    execute: async (params) => {
      const taskId = await createHumanTask({
        type: "dose_approval",
        priority: "high",
        title: params.title_he,
        reason: params.reason_he,
        payload: {
          channel: params.channel,
          amount_ml: params.amount_ml,
          reason_en: params.reason_en,
        },
        expires_in_hours: 0.5, // 30 min
      });
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
      const taskId = await createHumanTask({
        type: "manual_action",
        priority: "medium",
        title: params.title_he,
        reason: params.reason_he,
        payload: { observation_type: params.observation_type },
        expires_in_hours: 24,
      });
      return {
        kind: "observation_request_created",
        task_id: taskId,
        observation_type: params.observation_type,
      };
    },
  }),
};

export type AgentToolset = typeof agentTools;
