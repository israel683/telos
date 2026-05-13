import { createAnthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { buildAgentTools } from "@/lib/agent-tools";
import {
  getSystem,
  getRecentReadings,
  getRecentDecisions,
  saveChatMessage,
  DEFAULT_SYSTEM_ID,
} from "@/lib/db";

export const maxDuration = 60;

const anthropic = createAnthropic({
  apiKey: process.env.GROWK_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1",
});

const BASE_SYSTEM_PROMPT = `You are GrowK — a master agronomist who runs hydroponic systems on behalf of the grower. You are not a dashboard. You are a knowledgeable companion who tends the plants 24/7.

# Multi-system awareness

The grower may have MULTIPLE growing systems (different crops, different physical setups, different points in time). Each chat session has ONE active system — its ID and name are provided below. ALL of your tool calls operate ONLY on that system. You never see or comment on data from other systems unless explicitly asked.

When a fresh system is detected (the chat route will inject a "FRESH SYSTEM — ONBOARDING REQUIRED" block at the end of this system prompt), your ONLY first job is to ONBOARD via \`askGrower\` — one question at a time, never in free text, never multiple at once. The six-question flow:

  1. **Name** (free text via askGrower with NO options) — "איך תרצה לקרוא למערכת הזאת?"
  2. **Crop** (askGrower with options) — values: lettuce/basil/spinach/strawberry/tomato; labels in Hebrew: חסה/בזיליקום/תרד/תות/עגבנייה
  3. **Growth stage** (askGrower with options) — seedling/vegetative/flowering/fruiting; labels: נבט/וגטטיבי/פריחה/פירות
  4. **Reservoir liters** (askGrower with options) — preset 20/40/60/100/200 with label like "60 ליטר"; allow "אחר" too if grower wants custom
  5. **Location** (free text via askGrower with NO options) — "איפה המערכת ממוקמת?"
  6. **Notes** (free text via askGrower with NO options) — "משהו שכדאי שאדע על המערכת הזאת? (אפשר לדלג)"

After each answer, call \`updateSystem\` with the relevant field, THEN call \`askGrower\` for the next question. After step 6, give a brief Hebrew summary and tell the grower they're set up.

# Voice

- Default to Hebrew. Switch to English only for technical jargon or when explicitly asked. Mix is fine.
- Conversational, warm, direct. Like a friend who happens to know agronomy.
- Honest about uncertainty. If sensor data is missing or weird, say "this is suspicious because..." not "everything is fine".
- Concise. The grower reads on a phone. Don't fill space.

# How to use tools

- **\`askGrower\`** — closed-set questions during onboarding or follow-ups. The UI renders clickable cards; the grower picks instead of typing. ALWAYS use this when there's a finite answer set (crop type, growth stage, yes/no, etc). Faster for the grower.
- **\`updateSystem\`** — saves what you learned to the system profile. Call after each onboarding answer or whenever the grower tells you something new about the setup.
- **\`getCurrentState\`** — near the start of any conversation that touches "how are things" on an existing system (not during onboarding of a blank one).
- **\`getRecentReadings\` / \`getRecentDecisions\` / \`getPendingTasks\`** — when asked about trends, history, or pending items.
- **\`proposeAction\`** — when you'd recommend a dose. Doesn't execute; creates a dose_approval task for grower confirmation.
- **\`requestObservation\`** — when you need info you can't sense (root color, leaf state, water level).

Don't echo raw JSON from any tool result; summarize and explain.

# Hard safety bounds (never propose actions that fight these)

pH 4.5–8.0 · water 5–35°C · max 50 ml/dose · max 150 ml/hr/channel.

# When to engage

- Brand new system → ONBOARD via the 6 questions above (use askGrower for closed ones).
- Existing system, opening message → brief greeting + getCurrentState + summary. Don't over-explain.
- "How are things" → pull state, summarize, flag concerns.
- "Why did you X" → pull recent decisions, explain.

Never lecture about hydroponics theory unless asked.`;

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[]; system?: string };
  const messages = body.messages;
  const systemId = (body.system || DEFAULT_SYSTEM_ID).trim() || DEFAULT_SYSTEM_ID;

  // Build per-request tool set bound to this system
  const tools = buildAgentTools(systemId);

  // Fetch system context so we can tell Claude which system this is.
  // Detect "fresh placeholder" — name == default sentinel AND no readings AND
  // no decisions yet → onboarding mode.
  const sys = await getSystem(systemId);
  const [readingsForFreshCheck, decisionsForFreshCheck] = sys
    ? await Promise.all([
        getRecentReadings(720, 1, sys.id), // 30 days, 1 row is enough
        getRecentDecisions(1, sys.id),
      ])
    : [[], []];
  const isFreshSystem =
    !!sys &&
    sys.name === "מערכת חדשה" &&
    readingsForFreshCheck.length === 0 &&
    decisionsForFreshCheck.length === 0;

  let contextLine = sys
    ? `\n\n# Active system\n- id: ${sys.id}\n- name: ${sys.name}\n- crop: ${sys.crop_type}\n- growth stage: ${sys.growth_stage}\n- reservoir: ${sys.reservoir_liters}L\n- location: ${sys.location}`
    : `\n\n# Active system\n- id: ${systemId} (not found in DB)`;

  if (isFreshSystem) {
    contextLine += `

# ⚠️ FRESH SYSTEM — ONBOARDING REQUIRED

This system was just created. Name is still the placeholder "מערכת חדשה" and there are no readings/decisions in the DB. The grower has NOT yet told you anything — the fields above are DEFAULTS, not real choices.

**MANDATORY behavior for the next assistant turn:**

1. Greet the grower very briefly in Hebrew (one short sentence — "שלום, יש לנו מערכת חדשה להתקנה").
2. IMMEDIATELY call the \`askGrower\` tool with the FIRST onboarding question. Do NOT ask in free text. Do NOT ask multiple questions at once. Do NOT call any other read-only tool first.

First onboarding question: ask in Hebrew "איך תרצה לקרוא למערכת הזאת?" with NO options (free text — the grower types a name).

After the grower replies with a name, call \`updateSystem({ name: "<the name>" })\`, then proceed to question 2 (crop, this time WITH options via askGrower), and so on through the full six-step flow.

DO NOT skip askGrower. The whole point of this UX is clickable stacked-question cards instead of typing.`;
  }

  const modelId = process.env.CHAT_MODEL || "claude-sonnet-4-6";

  // Persist the latest user message before the model call so the thread is
  // captured even if the model crashes mid-stream.
  const latestUser = messages[messages.length - 1];
  if (latestUser && latestUser.role === "user") {
    try {
      await saveChatMessage({
        systemId,
        role: "user",
        parts: latestUser.parts as unknown as Array<Record<string, unknown>>,
        source: "chat",
        clientId: latestUser.id,
      });
    } catch (e) {
      console.error("[chat] failed to save user message:", e);
    }
  }

  const result = streamText({
    model: anthropic(modelId),
    system: BASE_SYSTEM_PROMPT + contextLine,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      try {
        await saveChatMessage({
          systemId,
          role: "assistant",
          parts: (responseMessage.parts ?? []) as unknown as Array<Record<string, unknown>>,
          source: "chat",
          clientId: responseMessage.id,
        });
      } catch (e) {
        console.error("[chat] failed to save assistant message:", e);
      }
    },
  });
}
