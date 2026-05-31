import type {
  StateResponse,
  HumanTask,
  DecisionRow,
  WaterReading,
  SystemProfile,
} from "./types";
import { getActiveSystem } from "./system";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const API_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function withSystem(path: string): string {
  if (typeof window === "undefined") return path;
  const sys = getActiveSystem();
  if (!sys || sys === "default") return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}system=${encodeURIComponent(sys)}`;
}

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (API_TOKEN) h["Authorization"] = `Bearer ${API_TOKEN}`;
  return h;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const fullPath = withSystem(path);
  const res = await fetch(`${API_URL}${fullPath}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

export async function getState(): Promise<StateResponse> {
  return fetchJson<StateResponse>("/api/state");
}

export type GrowView = {
  system: {
    id: string;
    name: string;
    crop_type: string;
    cultivar_id: string | null;
    growth_stage: string;
    location: string;
  };
  cultivar: { id: string; name: string | null; provenance: string | null } | null;
  grow_profile: Record<string, unknown> | null;
  onboarding: {
    complete: boolean;
    total: number;
    unanswered: Array<{ id: string; question: string; required: boolean }>;
  };
  memory: Array<{ id: number; ts: string; kind: string; text: string }>;
  episodes: Array<{ id: number; ts: string; status: string | null; summary: string }>;
};

export async function getGrow(): Promise<GrowView> {
  return fetchJson<GrowView>("/api/grow");
}

export async function getReadings(hours = 24, limit = 200) {
  return fetchJson<{ readings: WaterReading[] }>(
    `/api/readings?hours=${hours}&limit=${limit}`
  );
}

export async function getDecisions(limit = 20) {
  return fetchJson<{ decisions: DecisionRow[] }>(`/api/decisions?limit=${limit}`);
}

export async function getTasks(status: "pending" | "done" | "dismissed" | "expired" = "pending") {
  return fetchJson<{ tasks: HumanTask[] }>(`/api/tasks?status=${status}`);
}

export async function completeTask(id: number, response = "") {
  return fetchJson<{ ok: true }>(`/api/tasks/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

/**
 * Approve + execute a dose_approval task in one click.  Hits the dose
 * endpoint, fires the pump, marks the task done.  Returns success or a
 * safety/hardware failure reason.
 */
export async function approveDoseTask(id: number) {
  return fetchJson<{
    ok: boolean;
    task_id: number;
    channel: string;
    physical_channel: number;
    amount_ml: number;
    runtime_seconds: number;
    error?: string;
    blocked_by_safety?: boolean;
    reason?: string;
  }>(`/api/tasks/${id}/approve`, { method: "POST" });
}

export async function dismissTask(id: number, response = "") {
  return fetchJson<{ ok: true }>(`/api/tasks/${id}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ response }),
  });
}

/**
 * Hide a pending task until N minutes from now.  Default 60.  Used by the
 * chat-thread task widget's "דחיית X" buttons.
 */
export async function snoozeTask(id: number, minutes = 60) {
  return fetchJson<{ ok: true; snoozed_until: string; minutes: number }>(
    `/api/tasks/${id}/snooze`,
    {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }
  );
}

export async function updateSystemProfile(patch: Partial<SystemProfile>) {
  return fetchJson<{ system_profile: SystemProfile }>("/api/system", {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

// === Systems CRUD ===

export type SystemSummary = {
  id: string;
  name: string;
  status: "active" | "paused" | "archived";
  created_at: string;
  archived_at: string | null;
  crop_type: string;
  growth_stage: string;
  reservoir_liters: number;
  system_type: string;
  location: string;
  outdoor: boolean;
  ai_cycle_minutes: number;
  tuya_device_id: string | null;
  notes: string | null;
  /** Safety-critical execution state — see lib/db.ts SystemRow. */
  autonomous_dosing_enabled?: boolean;
  doser_verified?: boolean;
  bottle_levels?: Record<string, number> | null;
  setup_completed_at?: string | null;
  dosing_config?: Record<string, unknown> | null;
  /** 'tuya_cloud' | 'home_assistant' | 'webhook_generic' — see SystemRow.device_source. */
  device_source?: string;
};

export async function listSystems(includeArchived = false) {
  const path = `/api/systems${includeArchived ? "?archived=1" : ""}`;
  const res = await fetch(`${API_URL}${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<{ systems: SystemSummary[] }>;
}

export async function createSystem(input: {
  name: string;
  id?: string;
  crop_type?: string;
  growth_stage?: string;
  reservoir_liters?: number;
  notes?: string;
}) {
  const res = await fetch(`${API_URL}/api/systems`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{ system: SystemSummary }>;
}

export async function archiveSystem(id: string) {
  const res = await fetch(`${API_URL}/api/systems/${id}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<{ ok: true; mode: "archived" }>;
}

/**
 * Permanently remove a system and ALL its child data (readings, decisions,
 * doses, tasks, chat). Irreversible.  Used by the SystemSwitcher trash
 * button when the grower confirms they want the system fully gone, not
 * just hidden.
 */
export async function deleteSystem(id: string) {
  const res = await fetch(`${API_URL}/api/systems/${id}?hard=1`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<{ ok: true; mode: "hard_deleted"; deleted_system: string | null }>;
}

/**
 * Flip the master autonomous-dosing toggle.  Server-side will refuse to
 * enable if doser_verified is still FALSE.
 */
export async function setAutonomousDosing(id: string, enabled: boolean) {
  const res = await fetch(`${API_URL}/api/systems/${id}/autonomous`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<{
    ok: true;
    autonomous_dosing_enabled: boolean;
    note: string;
  }>;
}

export async function patchSystem(
  id: string,
  patch: Partial<{
    name: string;
    status: "active" | "paused" | "archived";
    crop_type: string;
    growth_stage: string;
    reservoir_liters: number;
    system_type: string;
    location: string;
    outdoor: boolean;
    ai_cycle_minutes: number;
    notes: string | null;
  }>
) {
  const res = await fetch(`${API_URL}/api/systems/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ system: SystemSummary; transition: string | null }>;
}
