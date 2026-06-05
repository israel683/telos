// Mirrors the Python API response shapes from api/server.py.

export type AgentStatus = "healthy" | "attention" | "warning" | "critical" | "unknown";

export type WaterReading = {
  timestamp: string;
  ph: number | null;
  ec: number | null;
  tds: number | null;
  orp: number | null;
  water_temp: number | null;
  cf: number | null;
  salinity: number | null;
  sg: number | null;
  source: string;
};

export type SystemProfile = {
  system_type: string;
  reservoir_liters: number;
  crop_type: string;
  growth_stage: string;
  location: string;
  outdoor: boolean;
};

export type AgentInfo = {
  cycle_count: number;
  next_ai_seconds: number;
  mock_mode: boolean;
  model: string | null;
};

export type PendingTaskCounts = {
  total: number;
  by_priority: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };
};

export type DecisionRow = {
  id: number;
  timestamp: string;
  status: AgentStatus;
  analysis: string;
  message: string;
  raw_response: any;
  // Token telemetry is internal-only (it reveals the LLM + cost structure) and
  // is NOT exposed by the customer-facing API. Optional so the type tolerates
  // its absence.
  tokens_input?: number;
  tokens_output?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
};

export type StateResponse = {
  agent: AgentInfo;
  current_reading: WaterReading | null;
  last_decision: DecisionRow | null;
  pending_tasks: PendingTaskCounts;
  system_profile: SystemProfile;
};

export type HumanTaskPriority = "low" | "medium" | "high" | "urgent";
export type HumanTaskType =
  | "water_change"
  | "dose_approval"
  | "system_reset"
  | "question"
  | "manual_action";

export type HumanTask = {
  id: number;
  system_id: string;
  created_at: string;
  type: HumanTaskType;
  priority: HumanTaskPriority;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  status: "pending" | "done" | "dismissed" | "expired";
  expires_at: string | null;
  completed_at: string | null;
  user_response: string | null;
  decision_id: number | null;
};
