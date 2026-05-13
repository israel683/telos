# GrowK Deployment Guide

End-to-end deploy of the Python agent and the Next.js dashboard to the cloud.

| Component | Platform | Reason |
|---|---|---|
| Python agent (loop + FastAPI) | **Railway** | container-based, always-on, persistent volume for SQLite |
| Next.js dashboard + chat | **Vercel** | native Next.js DX, edge CDN, easy env management |

> SQLite stays for POC (single writer, tiny dataset). When we need multi-instance or branching, migrate to Neon Postgres — code already isolates the data layer in `growk/data/store.py`.

---

## Prerequisites

1. **GitHub account** + a new repo (private). Push the local `Code/` directory to it.
2. **Railway account** — https://railway.app (free tier supports our needs).
3. **Vercel account** — https://vercel.com (Hobby plan free).
4. **Existing keys:** `ANTHROPIC_API_KEY` (from console.anthropic.com), Tuya creds, Jebao creds — all already in `growk/.env` locally.

---

## Step 1 — Push to GitHub

```bash
cd /Users/israelferrera/Desktop/growk/Code
git init
git add -A
git commit -m "initial: GrowK agent + dashboard"
git branch -M main

# Create a private repo on GitHub (via web or gh CLI):
#   gh repo create growk --private --source=. --remote=origin --push

# Or manually:
git remote add origin git@github.com:<your-username>/growk.git
git push -u origin main
```

> Sanity check: `git status` shows clean, no `.env` files in `git ls-files`.

---

## Step 2 — Deploy Python agent to Railway

1. Go to https://railway.app → **New Project** → **Deploy from GitHub repo** → select your `growk` repo.
2. Railway will scan the repo and find `growk/Dockerfile`. Set the service **Root Directory** to `growk` (in service Settings → Source).
3. Add a **Volume** mounted at `/app/db_data` (Settings → Volumes → Mount Path `/app/db_data`). This keeps the SQLite DB across redeploys.
   > **Important:** the mount path must be `/app/db_data`, NOT `/app/data`. The latter would shadow the Python `data/` package that contains `store.py` and crash the container at import time. (Learned from PR #1.)
4. **Variables** tab — set:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   CLAUDE_MODEL=claude-sonnet-4-6
   TUYA_ACCESS_ID=...
   TUYA_ACCESS_SECRET=...
   TUYA_API_ENDPOINT=https://openapi.tuyaeu.com
   TUYA_SENSOR_DEVICE_ID=...
   JEBAO_USERNAME=...
   JEBAO_PASSWORD=...
   JEBAO_REGION=us
   SYSTEM_TYPE=nft_wall_mounted
   RESERVOIR_LITERS=60
   CROP_TYPE=lettuce
   SENSOR_POLL_INTERVAL=30
   AI_CYCLE_INTERVAL=3600
   LOG_LEVEL=INFO
   GROWK_API_HOST=0.0.0.0
   GROWK_API_TOKEN=<generate a random string — used for auth from Vercel>
   GROWK_CORS_ORIGINS=https://<your-vercel-domain>.vercel.app
   DB_PATH=/app/db_data/growk.db
   ```
   The `PORT` variable is injected by Railway automatically.
5. **Settings → Networking → Generate Domain.** Copy the public URL — you'll need it for Vercel.
6. **Deploy.** First build takes ~3 minutes. Check `/api/health` returns `{"ok": true}`.

---

## Step 3 — Deploy dashboard to Vercel

1. Go to https://vercel.com → **Add New → Project** → import the same GitHub repo.
2. Set **Root Directory** to `web`.
3. Framework Preset: **Next.js** (auto-detected).
4. **Environment Variables**:
   ```
   GROWK_ANTHROPIC_KEY=sk-ant-...   # same key as Railway, but Vercel doesn't have the parent-shell leak so plain ANTHROPIC_API_KEY would work too
   ANTHROPIC_API_KEY=sk-ant-...     # mirror, for safety
   CHAT_MODEL=claude-sonnet-4-6
   AGENT_API_URL=https://<your-railway-domain>.up.railway.app
   AGENT_API_TOKEN=<same as GROWK_API_TOKEN on Railway>
   NEXT_PUBLIC_API_URL=https://<your-railway-domain>.up.railway.app
   ```
5. **Deploy.** First build takes ~1–2 minutes.
6. Once live, go back to Railway and update `GROWK_CORS_ORIGINS` to the real Vercel URL (e.g. `https://growk.vercel.app`).
7. Hit your Vercel URL — chat, /state, /decisions should all be live.

---

## Step 4 — Verify

- **Health:** `https://<railway>/api/health` → `{"ok":true,"ts":"..."}`
- **State:** `https://<vercel>/state` → shows live sensor reading (assuming the PH-W218 is online).
- **Chat:** `https://<vercel>/` → send "מה מצב המערכת?" — should call the agent and reply.
- **Decisions:** `https://<vercel>/decisions` → list of autonomous-cycle decisions.

If state shows empty: the agent hasn't completed its first AI cycle yet — wait up to `AI_CYCLE_INTERVAL` seconds.

---

## Updating

```bash
git add -A
git commit -m "update X"
git push
```
- Railway auto-redeploys on push (sees `growk/` changes).
- Vercel auto-redeploys on push (sees `web/` changes).

---

## Common issues

- **Vercel chat returns 404 from Anthropic:** `ANTHROPIC_BASE_URL` not set; we pin it in code, but if there's an inherited platform env, override.
- **CORS error in browser console:** Update `GROWK_CORS_ORIGINS` on Railway to your exact Vercel URL.
- **Railway crash on first start:** Volume must be mounted before container start; check Settings → Volumes.
- **SQLite locked:** Only one Railway instance writes. Don't enable horizontal scaling for the agent service.

---

## Cost expectation

- **Railway:** ~$5/month for the agent container + small volume.
- **Vercel:** Free Hobby tier covers our usage.
- **Anthropic:** ~$1–5/month at our cadence (1 system, hourly cycles, with prompt caching).
- **Total:** <$10/month.
