# Telos Deployment Guide

Telos is a hydroponics **Brain**: a single Next.js 16 (TypeScript) app in `Code/web`, deployed on **Vercel**, with data in **Neon Postgres**. There is no separate agent service.

The Brain, the crons, sensor polling, chat, and the database all run **inside the web app**:

- Brain: `web/src/lib/brain.ts` (`analyzeAndDecide()`)
- Cycle orchestration: `web/src/lib/cycle.ts` (`runSystemCycle()`)
- Brain path: `/api/cron/cycle` → `runSystemCycle()` → `analyzeAndDecide()`

The web app calls the **Anthropic API directly** (no gateway): model `claude-sonnet-4-6`, 1h prompt cache, `generateText`, `maxOutputTokens 4096`, 45s abort.

> **Production:** https://app.telos.ag (custom domain, live since 31 May 2026).

> The Python service in `Code/growk` is **legacy/archived**. There is no separate agent service, no Railway, no SQLite, no FastAPI in production. Ignore any older docs that mention them.

---

## Architecture (one platform)

| Component | Platform | Notes |
|---|---|---|
| Brain + crons + sensor polling + chat + API | **Vercel** (Next.js 16) | everything runs in `Code/web` |
| Database | **Neon Postgres** | connected via `DATABASE_URL` (pooled) |
| LLM | **Anthropic API** (direct) | `claude-sonnet-4-6`, 1h prompt cache |

Deploy = push `Code/web` to Vercel, connect Neon via `DATABASE_URL`, set env vars, done. There is **no** Railway step and **no** Python step.

---

## Prerequisites

1. **GitHub** repo containing `Code/`.
2. **Vercel** account/project, **Root Directory** set to `web`.
3. **Neon** Postgres database (get the **pooled** connection string for `DATABASE_URL`).
4. Keys/creds: Anthropic API key, Tuya creds, Jebao creds, and (optional) Resend + VAPID for notifications.

---

## Step 1 — Connect Neon

1. Create (or open) the Neon project and copy the **pooled** connection string.
2. Set it as `DATABASE_URL` in Vercel (Step 3). Neon scale-to-zero is fine; the app is written to tolerate cold starts and fail fast on DB errors.

---

## Step 2 — Deploy to Vercel

1. Vercel → **Add New → Project** → import the GitHub repo.
2. **Root Directory:** `web`.
3. **Framework Preset:** Next.js (auto-detected). Build/install come from `web/vercel.json`.
4. Set environment variables (Step 3).
5. **Deploy.** Crons are registered automatically from `web/vercel.json` on deploy.
6. Map the production domain to **app.telos.ag**.

---

## Step 3 — Environment variables (Vercel)

**LLM (Anthropic, direct):**
```
ANTHROPIC_API_KEY=sk-ant-...        # or GROWK_ANTHROPIC_KEY (either is accepted)
CHAT_MODEL=claude-sonnet-4-6
```

**Database (Neon, pooled):**
```
DATABASE_URL=postgres://...         # Neon pooled connection string
```

**Tuya (sensor):**
```
TUYA_ACCESS_ID=...
TUYA_ACCESS_SECRET=...
TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
TUYA_SENSOR_DEVICE_ID=...
```

**Jebao (doser):**
```
JEBAO_USERNAME=...
JEBAO_PASSWORD=...
```

**Cron + ingest auth:**
```
CRON_SECRET=...                     # authenticates /api/cron/*
INGEST_SECRET=...                   # authenticates /api/sensor/ingest (Home Assistant push)
                                    # Empty today, so HA push 401s until this is set.
```

**Email notifications (Resend) — no-op if unset:**
```
RESEND_API_KEY=...
ALERT_EMAIL_TO=...
ALERT_EMAIL_FROM=...
```

**Web Push notifications (VAPID):**
```
VAPID_PRIVATE_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_SUBJECT=mailto:...
```

**Owner-only:**
```
NEXT_PUBLIC_SHOW_ARCHITECTURE=1     # unhides the /architecture page
```

### Do NOT set (legacy — remove if present)
These belonged to the dead Railway/Python/growk-API architecture and must be deleted:
```
GROWK_API_HOST / GROWK_API_TOKEN / GROWK_CORS_ORIGINS / GROWK_CORS_ORIGIN_REGEX
AGENT_API_URL / AGENT_API_TOKEN
NEXT_PUBLIC_API_URL (any *.up.railway.app value)
DB_PATH (SQLite)
```

---

## Crons (defined in `web/vercel.json`, NOT the dashboard)

Vercel reads these from `web/vercel.json` on each deploy. All cron routes are authenticated by `CRON_SECRET`.

| Path | Schedule | Cron expr | Purpose |
|---|---|---|---|
| `/api/cron/poll` | every 15 min | `*/15 * * * *` | sensor polling |
| `/api/cron/cycle` | every 2h at :17 | `17 */2 * * *` | Brain cycle → `runSystemCycle()` → `analyzeAndDecide()` |
| `/api/cron/daily-report` | 08:00 daily | `0 8 * * *` | daily report |

To change a schedule, edit `web/vercel.json` and redeploy. Do not edit cron schedules in the Vercel dashboard.

---

## Safety model (read before touching dosing)

Onboarding is **one ordered conversational chat interview** triggered by **"New System"** (no signup, single admin).

`control_mode` is the branch point and is **subtract-only**: it routes doses to approval tasks and can **never** enable a pump. Autonomous dosing requires **all** of:

- `control_mode === 'brain_doser'`
- `autonomous_dosing_enabled`
- `doser_verified`

This is resolved by `resolveExecutionPosture()` in `web/src/lib/control-mode.ts`. Nothing in deploy/env overrides it.

---

## Verify after deploy

- **Domain:** https://app.telos.ag loads.
- **DB:** dashboard renders live state (Neon reachable via `DATABASE_URL`).
- **Sensor:** `confirmSensorBinding` does a **live Tuya read** during onboarding; watch for an "IoT Core subscription expired" message if the Tuya subscription has lapsed.
- **Doser:** `confirmDoserBinding` lists Jebao devices.
- **Crons:** in Vercel → project → Cron Jobs, confirm `poll`, `cycle`, `daily-report` are registered from `vercel.json`. They require `CRON_SECRET`.
- **Notifications (optional):** Web Push needs the VAPID trio + `public/sw.js` + a `push_subscriptions` row; email needs the Resend trio. Both are no-ops if unset.

---

## Updating

```bash
git add -A
git commit -m "update X"
git push
```

Vercel auto-redeploys on push (Root Directory `web`). Crons re-register from `web/vercel.json` on every deploy.

---

## Common issues

- **HA sensor push returns 401:** `INGEST_SECRET` is unset/empty. Set it on Vercel and on the Home Assistant side.
- **Cron returns 401:** `CRON_SECRET` missing or mismatched.
- **DB errors / cold start:** confirm `DATABASE_URL` is the **pooled** Neon string; the app fails fast on DB errors by design.
- **Live Tuya read fails during onboarding:** check Tuya creds and that the Tuya "IoT Core" subscription has not expired.
- **No push notifications:** VAPID trio not set, or no `push_subscriptions` row; email falls back only if the Resend trio is set.

---

## Cost expectation

- **Vercel:** Hobby/Pro per usage.
- **Neon:** compute is a cost constraint — keep polling visibility-aware and crons lean (scale-to-zero low, fail-fast DB).
- **Anthropic:** modest at this cadence with 1h prompt caching.
