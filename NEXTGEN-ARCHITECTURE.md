# TELOS — Next-Generation Brain Architecture

> Companion to `ARCHITECTURE.md` (current POC 0.4). This document defines the next
> iteration of the Brain: the move from a stateless model to a **per-grow personal
> Brain** with persistent, layered knowledge. Lean and sharp — built to run
> version to version. Grounded in the brand book (`../Knowledge/`).

---

## 0 · The two insights that drive everything

1. **The brand sells _cultivar_; the code knows _crop_.** Today the Brain knows
   `"basil"` (a hardcoded `CROP_DATABASE` of 5 crops with flat pH/EC/temp ranges in
   `growk/agent/prompt_engine.py`). It does not know *Genovese DOP from Liguria*. The
   entire premium, the positioning, and the data moat live in that gap. Closing it is
   the headline of this iteration.

2. **The Brain is stateless; it must become stateful.** Today every cycle is a fresh
   system prompt + a round-trip to the model. There is no memory of *this* grow. The
   next Brain carries a personal memory of the grow and the grower — knowledge that
   accumulates, not knowledge that is re-sent.

---

## 1 · The Brain = three knowledge layers + one reasoning loop

The brand says the Brain **reads** and **knows**. "Reads" already works (windowed
sensor stats: 5m/1h/6h/24h, 3σ noise rejection). "Knows" is split into three layers:

| Layer | What it holds | Shared / Personal | Brand meaning |
|---|---|---|---|
| **Network Knowledge** — the cultivar canon | provenance, target curves **by growth stage**, known stress signatures, harvest-readiness markers, the chef story | shared across all grows; improves from every grow | the data flywheel — "the tenth grow gets a better Brain than the first" |
| **Grow Context** — the personal Brain of this grow | built at onboarding: location, climate/weather, system type (DWC/NFT/drip), water-source baseline, light, the cultivar + seed provenance, the business goal (which chef, target harvest), the grower's own practices | personal to the grow | the "personal Brain" that earns the premium and the lock-in |
| **Grower Memory** — persistent | semantic facts the grower confirms ("30 °C is my summer normal"), plus an episodic log of decisions → outcomes → grower corrections | personal, persistent | the memory the round-trip model never had |

**The reasoning loop**, as explicit, observable phases:

```
gate → read → retrieve → reason → validate(safety) → act → record → remember
```

`retrieve` is the architectural change: instead of stuffing everything into one
prompt, we assemble context per cycle — a **stable cached layer** (cultivar canon +
grow profile, changes rarely) and a **dynamic layer** (sensor windows, recent doses,
retrieved relevant memories). This keeps the prompt bounded as knowledge grows, and
keeps cache hit-rate high.

---

## 2 · The precedence law (so memory never conflicts)

The grower's knowledge must enrich the Brain without breaking safety or polluting the
shared canon. Every value the Brain reasons on resolves in this strict order:

```
1. Safety hard-limits          — never overridden
2. Grower-confirmed facts      — the personal memory the grower approved
3. Grow Context / profile      — onboarding answers
4. Network cultivar protocol   — the shared canon for this cultivar
5. Species defaults            — fallback (today's CROP_DATABASE)
```

The personal memory stays **local to the grow**. Only anonymised / aggregated grow
data flows back into Network Knowledge — exactly as the pilot terms in the book
promise ("the grower keeps their farm; TELOS uses aggregated data to improve the Brain
for the network").

---

## 3 · Decisions locked for this iteration

- **Keep the two implementations** (Python on Railway, TypeScript on Vercel) for now.
  Consolidation is deferred — not tackled in this iteration.
- **But the knowledge is one source of truth, language-neutral.** To keep "dual" from
  doubling the core, both implementations *consume* the same knowledge; neither
  *re-implements* it:
  - **Static knowledge (cultivar protocols)** lives as **version-controlled files in
    the repo** (Git history + review; no authoring UI yet), loaded into the DB on
    deploy/seed.
  - **Dynamic state (grow profile, memory)** lives in **Postgres** and is read by both
    Python and TS through one shared schema + a small shared spec.
- **Multi-grower schema, minimal onboarding UX.** `system_id` already threads
  everywhere; the schema is multi-grower from day one. The questionnaire UX stays
  minimal — one grower for the POC.
- **Same hardware, portable contract.** Stay on Tuya (sensor) + Jebao/Gizwits (doser)
  for this POC, but build a capability-based device contract now so the next hardware
  is a driver + config, not a rewrite.
- **Advisor-only stays a first-class mode** — the Brain recommending with no Doser is
  the "lightest TELOS of all" from the book and the natural pilot entry.

---

## 4 · Workstreams & sequence (generic mechanisms first, one cultivar last)

1. **Cultivar registry** — replace `CROP_DATABASE` as the *source*. Hierarchy
   `species → cultivar → protocol-version`; target **curves by growth stage** instead
   of flat ranges. Files in repo → loaded to DB. `CROP_DATABASE` stays as fallback.
2. **`grow_profile` (typed) + onboarding engine skeleton** — generic, applies to any
   cultivar. Elevate the existing `human_tasks` `question` type into a real onboarding
   flow that writes a typed profile.
3. **Grower Memory store + write-back** — semantic facts (editable, override
   `target_ranges`) + episodic log. Write back after each cycle. Enforce the
   precedence law (§2).
4. **One context-assembly** that both languages call — stable cached layer + dynamic
   layer.
5. **Feed one flagship cultivar end-to-end** (e.g. Basilico Genovese DOP) and watch the
   full pipeline run.
6. **Cross-cutting, throughout:**
   - **Brand-voice guard** on every grower-facing string (the vocabulary law: never
     *smart / AI / optimize / sensor / device*; always *cultivar / the Brain / reads /
     knows / ready*). See `../Knowledge/brand.md` §01.
   - **Weather / location feed** into Grow Context (the grower's climate is part of the
     personal Brain — outdoor/indoor already flagged via `systems.outdoor`).

---

## 5 · Data-model deltas (concrete)

- **Cultivar registry (repo files)** — one file per cultivar/species: `species`,
  `cultivar`, `provenance`, `protocol_version`, `inherits`, `stages` (per-stage target
  bands for pH/EC/water_temp), `stress_signatures[]`, `harvest_markers[]`, `story`
  (HE+EN). **Implemented** at `growk/cultivars/` (deployed with the Python Brain;
  authoring + Git review source of truth). When the TS dashboard is wired, these seed a
  shared `cultivars` DB table that both runtimes read — the DB becomes the
  cross-service runtime source. See `growk/cultivars/README.md` for the schema.
- **`grow_profiles` (Postgres)** — `system_id`, `cultivar_id`, `location`,
  `system_method`, `water_baseline`, `light`, `business_goal`, `practices[]`,
  `onboarding_completed_at`.
- **`grower_facts` (Postgres)** — `system_id`, `key`, `value`, `confirmed_at`,
  `source` (grower / inferred). These override `target_ranges`.
- **`grow_events` (Postgres, episodic)** — `system_id`, `ts`, `kind`
  (decision / outcome / correction), `payload`, optional `decision_id` FK. Retrievable.

Existing tables (`systems`, `sensor_readings`, `ai_decisions`, `dosing_actions`,
`human_tasks`, `chat_messages`) are unchanged; the new tables hang off `system_id`.

---

## 6 · Hardware capability contract (portability without a rewrite)

`devices/base.py` is already a clean abstraction (the Brain never references Tuya /
Jebao directly). To make it copyable:

- Each driver **declares capabilities**: which metrics it reads, which channels it can
  dose, flow-rates, calibration. The Brain reasons on the declaration, not on built-in
  knowledge of the device.
- **Driver registry + config binding** — new hardware = new driver + config, zero Brain
  changes.
- Keep the cloud adapter boundary (Tuya Cloud / Gizwits); make **Home Assistant push**
  the canonical transport (`device_source` already exists) to avoid lock-in to a
  vendor's polling.

---

## 7 · Explicitly deferred

- Consolidating Python + TS into one Brain (revisit once the knowledge layer is the
  shared source of truth and the drift surface is small).
- Authoring UI for cultivar protocols (files + Git review are enough for now).
- Rich onboarding UX (minimal questionnaire for the POC).
- Bringing `Knowledge/` under version control alongside `Code/` (flagged: the brand
  book currently sits outside the git repo).

---

## 8 · Current production state (TS / Vercel) — what's actually shipped

> This section is the ground truth for the running system. Where it differs from the
> planned names in §5, **§8 wins** (§5 is the original design intent).

**Knowledge layers — as built.**
- **Network Knowledge** — the cultivar registry: `growk/cultivars/*.json` → `npm run
  sync:cultivars` → committed `web/src/lib/cultivars.generated.ts` (stage bands,
  `stress_signatures`, `harvest_markers`, `story`, and a `harvest` model:
  `mode` ∈ cut_and_come_again | repeated_pick | single_terminal, cadence, instructions).
  Inheritance via `inherits` (`resolveCultivarStage` / `resolveCultivarHarvest`).
- **Grow Context** — `systems.grow_profile` **JSONB** (one blob, not a separate
  `grow_profiles` table): onboarding answers, `onboarding_completed_at`, `harvest_plan`,
  `timeline[]` (+ `grow_anchor_date/kind`).
- **Grower Memory** — table `grower_memory` (not `grower_facts`): `kind`, `text`,
  `source`, plus fidelity columns `raw_answer` + `source_flags` (the grower's verbatim
  words are preserved even when the Brain-facing `text` is de-noised; a render fallback
  shows the raw for short/anaphoric answers).
- **Episodic memory** — table `grow_episodes` (not `grow_events`): the Brain's
  newest-first narrative log of each cycle.

**The autonomous loop (Vercel crons, `vercel.json`).**
- `/api/cron/poll` — `*/15 * * * *` (sensor poll).
- `/api/cron/cycle` — `17 */2 * * *` (the Brain decision cycle, every 2h at :17).
- `/api/cron/daily-report` — `0 8 * * *` (morning summary).
- **Cycle gate** (`lib/cycle-gate.ts`) — a local pre-check that runs the LLM only when
  it's worth it: stale sensor, critical envelope, **out-of-tolerance-band** drift,
  pending high-priority task, or an elapsed next-check. Band-aware (ignores normal
  diurnal swing). **water_temp is deliberately NOT a wake trigger** (structural heat on
  an outdoor rig can't be dosed away; the real danger end is still caught by the
  critical envelope, and `water_temp_critical_high` is 34 °C — near the 35 °C dosing
  block).
- **Safety** (`lib/safety.ts`) — pH titration controller: opposite-direction lockout,
  settle window, per-dose / hourly / daily caps, bottle floor, sensor-freshness gate.

**Harvest = the Single Source of Truth (coherence across all surfaces).**
- `grow_profile.harvest_plan` is the one stored harvest date; every surface (dashboard,
  grow page, `/grow/timeline`, the Brain's analysis) reads it (directly or via
  `deriveTimeline`).
- The grower can move it in chat (`adjustHarvestPlan`), which stamps `grower_moved_at`;
  the Brain then **respects** that date (prompt surfaces it; the cron preserves it) and
  cannot reset it. Moving it **supersedes** the now-stale harvest/prep task (honest
  `dismissed` + episode), linked by `payload.timeline_event_id`.
- All `grow_profile` writes on this path go through `mergeGrowProfileKey` — a single
  atomic **key-level** `jsonb_set` (no whole-blob clobber / write race).

**The Grow Timeline + backward Journal.**
- `grow_profile.timeline: TimelineEvent[]` — a forward plan (PR-1 derives it read-only
  from `harvest_plan` + onboarding; full Brain-ownership is the next track).
- `GET /api/timeline` — `forward` (the plan) + `past` (a grower-safe JOURNAL of episodes
  + grower/manual tasks). **IP boundary is structural**: `lib/journal.ts` builds each
  event from a fixed allowlist of named fields (never spreads a source row), so
  confidential columns (`raw_response`, `tokens_*`, `decision_id`, `system_id`,
  `payload`) cannot leak. `?snapshot=1` serves the dashboard's compact next/last.

**IP-confidentiality doctrine** (`brand/voice.ts`). The agent explains grow STATES and
WHY a guardrail exists in agronomic terms, but never reveals model/vendor/prompt/tools/
code/DB/rules. Enforced in chat (anti-injection block) and surfaced wherever grower-facing
text is produced. The `/architecture` page is gated behind `NEXT_PUBLIC_SHOW_ARCHITECTURE`;
the `/changelog` page is benefit-framed and always visible.

**Owner-only observability.** The chat route emits a tool-activity log (names + token
usage only — never inputs/outputs) to server stderr, gated on `OWNER_DEBUG_ENABLED`
(a plain, non-`NEXT_PUBLIC_` server env var) — owner forensics that never reach a client.

**Resilience / lean compute.** Fail-fast Neon driver (`neonConfig.fetchFunction` with an
8s `AbortSignal.timeout`); visibility-aware polling (the UI polls only when the tab is
visible); on-demand (non-polling) reads for the timeline tab; key-level + `RETURNING`
writes to bound round-trips. (See the compute-budget doctrine.)
