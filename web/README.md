# TELOS

> "Every plant, its fullest self."

TELOS runs hydroponic systems on behalf of growers. It is a single Next.js 16
(TypeScript) app: sensors (Tuya PH-W218 over Gizwits cloud + an optional Home
Assistant push path) feed a Neon Postgres table; a Claude-driven autonomous
**Brain** runs on a cron and proposes or executes dosing on a Jebao MD-4.5
5-channel doser; and a chat agent (same Claude, different prompt) gives the
grower a conversational agronomist who can read sensors live, fire doses, and
update system configuration. The Brain, the crons, sensor polling, chat, and
the database all run **inside this one web app** — there is no separate agent
service. The app calls the Anthropic API directly (`claude-sonnet-4-6`, 1-hour
prompt cache). Everything is on Vercel + Neon. POC scale: one grower, one rig,
one crop at a time. (The Python service in `../growk` is legacy/archived.)

## Getting started

```bash
npm install
# create .env.local with DATABASE_URL, ANTHROPIC_API_KEY, etc.
# (or run `vercel env pull .env.local` if the project is linked)
npm run dev
```

The app runs at http://localhost:3000. There is no signup — a single admin
starts a new system via the **"New System"** flow, which kicks off one ordered
conversational chat interview (onboarding). `control_mode` is the branch point
of that interview and is **subtract-only**: it can route doses to approval
tasks but can never enable a pump on its own.

## Key files

| File | Responsibility |
|---|---|
| `src/lib/brain.ts` | The autonomous Brain — `analyzeAndDecide()` reasons over readings and proposes/executes dosing decisions. |
| `src/lib/cycle.ts` | `runSystemCycle()` — orchestrates one cron cycle: readings → gate → brain → tasks → execute. |
| `src/lib/control-mode.ts` | `resolveExecutionPosture()` — the subtract-only safety gate. Autonomy requires `control_mode === 'brain_doser'` **and** `autonomous_dosing_enabled` **and** `doser_verified`. |
| `src/lib/notify.ts` | `notifyGrower()` — grower notifications via Web Push (VAPID, `public/sw.js`, `push_subscriptions`) and email (Resend). |
| `src/lib/grow-profile.ts` | Per-grow profile, timeline, and the immutable baseline snapshot locked at `mark_complete`. |
| `src/app/api/chat/route.ts` | The chat agronomist — system prompt + tool catalog, calls Anthropic directly. |
| `src/lib/db.ts` | Neon Postgres access layer. |

## Brain path

```
/api/cron/cycle  →  runSystemCycle() (lib/cycle.ts)  →  analyzeAndDecide() (lib/brain.ts)
```

## Cron schedule

Defined in [`vercel.json`](./vercel.json):

| Path | Schedule | Purpose |
|---|---|---|
| `/api/cron/poll` | `*/15 * * * *` | Poll sensors every 15 min. |
| `/api/cron/cycle` | `17 */2 * * *` | Run the Brain cycle every 2 hours. |
| `/api/cron/daily-report` | `0 8 * * *` | Send the daily report at 08:00. |

## Deploy

Deployed on **Vercel** with data in **Neon Postgres**. Production domain:
**https://app.telos.ag** (custom domain since 31 May 2026; `growk-one.vercel.app`
is obsolete). See [`../DEPLOY.md`](../DEPLOY.md) for the full deploy runbook.

## Further reading

- **System map** — the interactive `/architecture` page. Set
  `NEXT_PUBLIC_SHOW_ARCHITECTURE=1` in your environment to expose it.
- **Canonical handoff** — [`docs/POC-0.4-HANDOFF.md`](./docs/POC-0.4-HANDOFF.md):
  what's built, what's stable, what's a redesign candidate.

---

*Next plant, next cycle.*
