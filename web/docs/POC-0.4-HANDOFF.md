# POC 0.4 — Handoff Brief

> "Every plant, its fullest self."
> Closing brief from POC 0.3.  Opening brief for POC 0.4.

This is the single document a fresh Claude project should ingest to pick
up where we left off.  It captures **what we built**, **what we learned**,
**what's stable**, and **what's a strong candidate for redesign**.

Pair this file with:
- `src/brand/voice.ts` — TELOS voice rules + forbidden word table (verbatim from Brand Kit v1.0)
- `src/brand/tokens.ts` — TELOS palette, type scale, spacing, radii, motion
- `TELOS Brand Kit v1.0` PDF + HTML in `/Users/israelferrera/Downloads/TELOS-Brand-Kit-v1.0/`
- `src/app/architecture/page.tsx` — interactive system map (also rendered at `/architecture`)

---

## 1. What TELOS is — one paragraph

TELOS runs hydroponic systems on behalf of growers.  Sensors (Tuya
PH-W218 over Gizwits cloud + an optional Home Assistant push path) feed
a Postgres table; a Claude-driven autonomous brain runs on a cron and
proposes / executes dosing on a Jebao MD-4.5 5-channel doser; a chat
agent (same Claude, different prompt) gives the grower a conversational
agronomist who can read sensors live, fire doses, and update system
configuration.  Everything is on Vercel + Neon.  POC scale: one grower,
one rig, one crop at a time.

The brand stance:  TELOS doesn't claim, demonstrate.  The plant is the
subject; we remove the noise.

---

## 2. What's deployed and stable (don't break)

These work, are tested, and represent real product value.  Refactor
should preserve their semantics even if the implementation changes.

| Subsystem | Lives in | Why it stays |
|---|---|---|
| **Cron cadence + cycle-gate** | `vercel.json` (cron every 2h) + `src/lib/cycle-gate.ts` | Cuts ~60% of LLM calls vs naive hourly. BYPASS / SKIP logic is honest. |
| **Dead-band controller + diurnal awareness** | `src/lib/tolerance.ts` + brain prompt | Stops chasing diurnal pH/EC noise.  Per-crop+stage defaults work. |
| **Safety controller (multi-layer)** | `src/lib/safety.ts` | autonomous-off-by-default + daily cap + bottle floor + interval + `is_priming` flag.  Earned scars from POC v02 + 0.3. |
| **Chat-push suppression** | `src/app/api/cron/cycle/route.ts` | Stops the alert-spam loop that 0.3 surfaced (30+ identical "pH high" pushes over 3 days). |
| **Task dedup (24h window)** | `src/lib/brain.ts` + `hasRecentTaskOfType` | Prevents #45→#47→#48 churn. |
| **Sensor source: dual Tuya + HA push** | `src/lib/devices/tuya.ts` + `src/app/api/sensor/ingest/route.ts` | HA push is the long-term canonical path; Tuya kept as backup. |
| **Doser protocol + bottle inventory + visual verification** | `src/lib/agent-tools.ts` (`runDoserProtocol`, `declareBottleLevels`, `verifyBottleLevels`) | Captures the POC v02 lesson — no autonomous dosing until visually verified. |
| **Per-system fertilizer profile + channel mapping** | `src/lib/dosing-config.ts` + `src/lib/fertilizer-profiles.ts` | Terra Aquatica Tri Part + LivinGreen "המושלם" supported.  Extensible. |
| **Brand voice in every LLM prompt** | `src/brand/voice.ts` imported by chat/route, prompt-engine, daily-report | Single source of truth. Updates flow. |
| **PWA installable + safe-area** | `public/manifest.webmanifest` + `layout.tsx` viewport | Grower can Add-to-Home-Screen. |
| **Sticky chat dock + image upload + client-side compression** | `src/app/page.tsx` | Vision input works; createImageBitmap path handles iPhone 48MP. |

---

## 3. What we learned the hard way (POC 0.3 retro)

These lessons are baked into the code now; the rationale lives here.

### 3a. Alert fatigue kills trust faster than missed alerts
For 3 days the brain pushed "pH 7.27 high — please add pH Down" every
2 hours while a manual_action task was open.  The grower stopped
reading.  Once they DID engage in chat, the situation was resolved in
under an hour.

**Implication for redesign:** the chat is the trustworthy channel.
The cron-push log is a passive timeline.  When cron has nothing new to
say, it should say nothing.

### 3b. Dedup that only checks "currently pending" tasks is broken
Task expires → next cycle thinks "no pending" → re-creates an identical
task.  Use a time window, not just status.

### 3c. The brain reasoned about absent inventory
On a system with no bottle_levels declared, the brain still suggested
specific ml amounts as if it knew there was liquid.  Inventory must
be a hard input the prompt sees, not an inference.

### 3d. "Accept this reality" needs first-class support
Grower said "water temp will always be 30°C+ in summer, accept it."
We had no way for them to widen the band; brain kept flagging it.
Now `setTargetRanges` exists.  Future design should make this a UI
toggle on the dashboard, not just a chat tool.

### 3e. Hardware quotas are a real failure mode
Tuya developer credits burned overnight → sensor blackout → cron-cycle
still ran every 2h producing "no readings, please check sensors" pings.
The HA push path was built specifically as the second-source answer
to this class of failure.

### 3f. iPhone photo upload is non-trivial
HEIC + 48MP overwhelms naive canvas decode → silent fallback to raw →
function payload too large.  Currently solved with `createImageBitmap`
+ resize; eventually wants Vercel Blob client-upload.

### 3g. The agent's outward voice was wrong for 90% of POC 0.3
Generic emoji-laden enthusiasm ("שלום ישראל 👋"), generic encouragement
("רוצים שאמשיך?"), generic optimization talk.  Brand Kit v1.0 arrived,
voice rules now baked into prompts.  Every LLM-facing surface is
constrained.

---

## 4. Strong refactor / redesign candidates (POC 0.4 charter)

Ordered by ROI.  Each item has a "what bothers me" + "what I'd
explore."  Treat as a menu, not a roadmap.

### 4.1 Component layer — there is none

Every component re-implements buttons, cards, borders, chips.  After
the TELOS wave 2 sweep, many surfaces use raw inline classes like
`bg-[var(--c-soil)] rounded-md p-4 border border-[rgba(238,237,232,0.07)]`
copy-pasted everywhere.

**What I'd explore:** a small primitives layer in `src/ui/`:
`<Card>`, `<EyebrowLabel>`, `<DataValue>`, `<Pill>`, `<Chip>`,
`<StatusDot>`.  Maybe based on shadcn/ui registry but TELOS-themed.
Migration is mechanical once the primitives exist.

### 4.2 MessageBubble + chat rendering

Still on `react-markdown` + inline zinc styles.  The validator has
been (correctly) nagging us to migrate to AI Elements MessageResponse
which handles streaming, tool-call rendering, file parts, and code
blocks out of the box.

**What I'd explore:** migrate the chat surface to `ai-elements`
(shadcn registry).  Re-skin to TELOS.  Drop a lot of bespoke code.

### 4.3 The 4-layer safety model is layered well but written ad-hoc

Cycle gate, safety controller, autonomous flag, bottle floor, daily
cap, is_priming exemption.  Each lives in its own file with its own
constants.  When a dose fails, the rejection reason walks through
multiple "if" branches before settling.

**What I'd explore:** a single `SafetyVerdict` pipeline — a list of
named guards (`SensorFreshness`, `BottleLevel`, `DailyCap`,
`Interval`, `BandReality`, etc.), each returning `{ pass | block,
reason }`.  Same logic, observable as data, testable.

### 4.4 Brand voice — currently prepended, not enforced

`TELOS_VOICE_PROMPT` is concatenated to every system prompt.  Claude
respects it ~85% of the time.  No automated check that outputs comply.

**What I'd explore:** a lightweight voice-lint step.  After generation,
a regex/keyword pass that flags forbidden words ("smart", "amazing",
"optimize"), emoji counts > 1, etc.  If a violation is detected,
either re-generate (one retry) or surface a debug log.

### 4.5 The cron-cycle handler is 320 lines of imperative logic

Loop over systems → expireTasks → readings → gate → brain → decision
→ tasks → execute → bottle decrement → chat push.  Reads as a saga.

**What I'd explore:** Vercel Workflow DKK or just a clean
`runCycle(system)` orchestrator with named phases.  Each phase
returns a typed result.  Logs are structured per phase.

### 4.6 Mobile layout is responsive but not mobile-first

Built desktop-first then hardened for mobile.  Still some Nav awkward-
ness on iPhone SE width; dashboard cards wrap acceptably but not
elegantly.

**What I'd explore:** a real mobile-first pass with the dock pattern
already established for chat extended to dashboard (bottom-bar nav?
swipeable cards?).  Brand kit dark + 8-pt grid + Cormorant numbers
look much better on a phone-sized canvas anyway.

### 4.7 Architecture page is a static doc, not living truth

Lists 23 blocks accurately as of late May.  Not auto-updated when
code changes.

**What I'd explore:** keep as a curated doc, OR replace with a
generated dependency graph (next/jsx tree → graphviz).  Probably the
manual curated version is fine if we commit to keeping it fresh.

### 4.8 Tuya cron-poll is still on, even though HA push works

`vercel.json` still runs `/api/cron/poll` every 5 minutes.  When HA
push is the canonical source, the Tuya path is dead weight + a
hardware-quota risk.

**What I'd explore:** kill the Tuya cron once HA push has a few days
of clean uptime.  Keep the Tuya client code in `lib/devices/tuya.ts`
as a manual fallback tool the grower can trigger.

### 4.9 Empty states and onboarding micro-copy

Did a wave 1 pass with TELOS voice.  Many secondary screens
(decisions, architecture, system-not-found, error states) still have
generic copy.

**What I'd explore:** a full sweep through every Hebrew string in the
app, checking against the voice rules.  Could be a quick pass once
the component primitives land (4.1).

### 4.10 Image upload — replace inline base64 with Vercel Blob

Compression hides the architecture problem but doesn't fix it.  A
sustained POC season will produce hundreds of plant photos in the
chat history; inlining them all in DB chat_messages bloats the row
size and re-sends them on every chat replay.

**What I'd explore:** Vercel Blob client-upload.  Image bytes
browser→Blob; chat_messages stores only the URL.  Long-term cleaner.

---

## 5. Open / pending items the next session inherits

- **Production URL**: `https://app.telos.ag` (custom domain, added 31 May 2026).  Old `growk-one.vercel.app` still resolves and serves identical content; safe to remove once external integrations are updated.
- **`INGEST_SECRET` on Vercel** is empty.  HA push endpoint returns 401 until set.  Grower needs to generate one and put it on both ends.  The endpoint URL is `https://app.telos.ag/api/sensor/ingest`.
- **POC 0.3 system row** is still active in DB (`--s0bn5`).  Decide whether to archive or keep as the active rig for POC 0.4.
- **`TUYA_ACCESS_ID`/`SECRET` rotation** — POC 0.3 burned credits on a Tuya cloud project.  New credentials for "Telos POC" with EU endpoint are deployed; should still be rotated when going past dev.
- **Bottle levels for POC 0.3** are NOT declared.  Brain has no inventory data.  Either declare them or the autonomous loop stays in propose-only mode (which is the safe default anyway).

---

## 6. Charter for POC 0.4

Working principles, drawn from POC 0.3's pain and the brand:

1. **The chat is the product.**  Dashboard is reference + approval; chat is the agronomist.
2. **Brand voice is law.**  Every Hebrew string flows through the voice rules.  Forbidden words don't ship.
3. **Don't apologise for being TELOS.**  We're software running a hydroponic system.  The plant doesn't know that.  Don't pretend.
4. **Defaults default to off.**  Autonomous dosing OFF, push-from-cron silent unless something changed, bands generous unless dialed.  Less is more in a POC.
5. **Refactor is encouraged.**  Anything in §4 can be ripped out and rebuilt.  Anything in §2 keeps its semantics even if the implementation changes.
6. **Voice + visual identity outranks "what's working."**  If a working pattern conflicts with the brand kit, the brand kit wins.

---

## 7. Quick orientation for the new Claude session

When the fresh project starts, useful files to read in this order:

1. `src/brand/voice.ts` (10 minutes — the most load-bearing file)
2. `src/brand/tokens.ts` (5 minutes)
3. This document (`docs/POC-0.4-HANDOFF.md`)
4. `src/app/api/chat/route.ts` (system prompt + tool catalog)
5. `src/lib/prompt-engine.ts` (autonomous brain prompt)
6. `src/lib/safety.ts` (the multi-layer guard model)
7. `src/lib/cycle-gate.ts` (the cost-saver)
8. `src/lib/tolerance.ts` (the dead-band controller)
9. `vercel.json` (cron schedule)
10. `/architecture` page (visual map)

Then start a conversation with: "I'm continuing POC 0.4.  What would
you redesign first?"

---

*End of brief.  Next plant, next cycle.*
