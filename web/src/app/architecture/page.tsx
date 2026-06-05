"use client";

/**
 * Interactive system architecture explorer.
 *
 * Single-page reference of the entire Telos stack — hardware, cloud APIs,
 * cron jobs, brain, safety/control layers, chat agent, dashboard, and the
 * grower interface — designed to be navigated together.  Click any block
 * to expand its deep-dive panel.  Hebrew with English code/file refs.
 */

import { useState, useMemo } from "react";
import { redirect } from "next/navigation";

type Block = {
  id: string;
  title_he: string;
  title_en: string;
  layer: "hw" | "cloud" | "server" | "lib" | "control" | "safety" | "ui" | "user";
  icon: string;
  summary_he: string;
  files: string[];
  concepts: { he: string; detail: string }[];
  depends_on: string[];        // block ids
  produces_for: string[];      // block ids
  ux_note_he?: string;
  gotchas_he?: string[];
};

const BLOCKS: Block[] = [
  {
    id: "tuya-sensor",
    title_he: "חיישן Tuya PH-W218",
    title_en: "Tuya PH-W218 multi-parameter probe",
    layer: "hw",
    icon: "🌡️",
    summary_he:
      "החיישן הפיזי שיושב במאגר וקורא pH / EC / TDS / ORP / טמפ' / מליחות / S.G. / CF.  מתקשר עם ענן Tuya דרך WiFi, מעדכן Tuya Cloud כל כמה שניות.",
    files: ["src/lib/devices/tuya.ts"],
    concepts: [
      {
        he: "DP mapping",
        detail:
          "Tuya מחזיר 'data points' עם שמות נסתרים: temp_current → water_temp ÷10, ph_current → ph ÷100, ec_current → ec, pro_current → S.G. ÷1000, וכו'.  המיפוי + ה-scale שמורים ב-DP_MAPPING בקובץ tuya.ts.",
      },
      {
        he: "Thing API דרושה",
        detail:
          "/v2.0/cloud/thing/{id}/shadow/properties — לא ה-/v1.0 הישן.  ה-API הישן מחזיר רק temp_current, חסר את כל ה-pH/EC.",
      },
      {
        he: "Token cache",
        detail:
          "access token נשמר ב-_cachedToken עד 30 שניות לפני תפוגה — חוסך call לכל קריאה.",
      },
    ],
    depends_on: [],
    produces_for: ["cron-poll", "poll-sensor-now"],
  },
  {
    id: "jebao-pump",
    title_he: "Jebao MD-4.5 דוזר 5 ערוצים",
    title_en: "Jebao MD-4.5 dosing pump (5 channels)",
    layer: "hw",
    icon: "💧",
    summary_he:
      "מערכת 5 משאבות פריסטלטיות (channe1..5) שמובילות מבקבוקי דשן / pH אל מאגר ה-NFT.  קצב זרימה תיאורטי 50 ml/min — נמדד פיזית ב-runDoserProtocol.",
    files: ["src/lib/devices/jebao.ts"],
    concepts: [
      {
        he: "Gizwits Cloud API",
        detail:
          "כל פקודה נשלחת ל-POST /app/control/{did} עם {attrs: {channeN: true/false}}.  הפעלת ערוץ → המתנה (ml/50 × 60s) → כיבוי.",
      },
      {
        he: "Master switch",
        detail:
          "מאפיין `switch` חייב להיות 1 אחרת ערוצים לא יורים בפועל גם אם מחליפים אותם.  doseChannelByPhysical שולח switch:true יחד עם הערוץ.",
      },
      {
        he: "Calibration mode",
        detail:
          "אחרי reset פיזי המכשיר נכנס לסטטוס CALSet='校准N' — אם זה לא מתאפס, יש להריץ /api/jebao/panicstop או לעבור דרך אפליקציית Jebao Aqua.",
      },
    ],
    depends_on: [],
    produces_for: ["execute-dose", "prime-channel"],
    gotchas_he: [
      "שמות ה-attrs הם channe1..channe5 (בלי 'l'!), Timer1ON..Timer8ON, CALSW, CALSet — לא channel_1.",
      "Calib1..5 הם read-only.  לכלול אותם ב-POST → ה-batch כולו נדחה (error 9025).",
    ],
  },
  {
    id: "cron-poll",
    title_he: "Cron — קריאת חיישנים",
    title_en: "Cron: /api/cron/poll (every 5 min)",
    layer: "server",
    icon: "📡",
    summary_he:
      "רץ כל 5 דקות (vercel.json).  עובר על כל המערכות הפעילות, מושך קריאה מ-Tuya דרך readTuyaSensor, שומר ל-sensor_readings.  אין קריאה ל-LLM כאן — חיישנים בלבד.",
    files: ["src/app/api/cron/poll/route.ts", "vercel.json"],
    concepts: [
      {
        he: "Mass production",
        detail:
          "מערכת אחת כיום, אבל הקרון מתחבר ל-listSystems() ויעבור עם הזמן ל-multi-rig בלי שינוי קוד.",
      },
      {
        he: "אין LLM",
        detail:
          "החיסכון העיקרי — 288 קריאות poll/יום עולות $0.  כל הצריכה ב-LLM היא רק במחזור /cycle או בצ'אט.",
      },
    ],
    depends_on: ["tuya-sensor"],
    produces_for: ["cycle-gate", "brain"],
  },
  {
    id: "cron-cycle",
    title_he: "Cron — מחזור החלטה",
    title_en: "Cron: /api/cron/cycle (hourly at :17)",
    layer: "server",
    icon: "🧠",
    summary_he:
      "המנוע האוטונומי.  כל שעה ב-:17 הוא מנסה לקרוא ל-Claude — אבל קודם עובר ב-cycle-gate שבודק אם בכלל יש מה לעשות.  ההחלטות יכולות להיות 'לדלג' (token=0), 'להציע task לאישור', או 'לירות מנה ישירות' (רק אם autonomous_dosing_enabled=true).",
    files: ["src/app/api/cron/cycle/route.ts"],
    concepts: [
      {
        he: "Cycle gate",
        detail:
          "בדיקה לוקלית של 6 תנאים (BYPASS) לפני שמשקיעים טוקנים: חיישן ישן / קריטי / מחוץ ל-band / משימות urgent / סטטוס לא-healthy / drift מהקריאה הקודמת.",
      },
      {
        he: "Honor next_check_at",
        detail:
          "כל החלטה של Claude מחזירה next_check_minutes.  המחזור מכבד את זה (עם floor של 90 דק' במצב healthy) ומעדכן את systems.next_check_at.",
      },
      {
        he: "Autonomous gate",
        detail:
          "כשautonomous_dosing_enabled=false: כל פקודת dose שהמוח מציע נרשמת כ-dose_approval Human Task במקום לרוץ.  זוהי שכבת ההגנה הראשית מ-runaway-dosing.",
      },
    ],
    depends_on: ["cycle-gate", "brain", "safety", "tolerance", "execute-dose"],
    produces_for: ["dashboard", "tasks-badge"],
  },
  {
    id: "cron-daily",
    title_he: "Cron — דו\"ח יומי",
    title_en: "Cron: /api/cron/daily-report (08:00)",
    layer: "server",
    icon: "📰",
    summary_he:
      "פעם ביום מסכם את 24 השעות האחרונות לתוך הודעת צ'אט בעברית.  קריאת LLM אחת ביום — זניחה.",
    files: ["src/app/api/cron/daily-report/route.ts"],
    concepts: [
      {
        he: "Hebrew narrative",
        detail:
          "Claude מקבל החלטות + פעולות + קריאות חיישן של 24h ומחזיר סיכום קצר שמודחף ל-chat_messages עם source='cron-daily'.",
      },
    ],
    depends_on: ["brain"],
    produces_for: ["chat-history"],
  },
  {
    id: "cycle-gate",
    title_he: "Cycle Gate — שכבת חיסכון",
    title_en: "Cycle gate — local pre-check before LLM",
    layer: "control",
    icon: "🚦",
    summary_he:
      "החלטה דטרמיניסטית: האם שווה לקרוא ל-Claude בכלל?  BYPASS (לרוץ) ב-6 מקרים, SKIP (לא לרוץ, 0 טוקנים) אם הכל יציב.  חוסך 50-70% מהקריאות במצב בריא.",
    files: ["src/lib/cycle-gate.ts"],
    concepts: [
      {
        he: "BYPASS triggers",
        detail:
          "1) חיישן >10 דק' ישן  2) ערך קריטי (pH <5/>7.5 EC <200/>3000 temp <10/>30)  3) מחוץ לתוך tolerance band  4) משימת high/urgent ממתינה  5) ההחלטה הקודמת לא healthy  6) drift גדול לעומת ההחלטה הקודמת.",
      },
      {
        he: "SKIP rationale",
        detail:
          "אם הכל בסדר ו-next_check_at עדיין בעתיד → נכתבת decision row עם 0 טוקנים, ai_status='gate-skip', בלי הודעה לצ'אט.  ה-cron 'מתעורר' בלי לבזבז.",
      },
    ],
    depends_on: ["tolerance"],
    produces_for: ["cron-cycle"],
  },
  {
    id: "brain",
    title_he: "Brain — מוח החלטות",
    title_en: "Brain — analyzeAndDecide via Claude",
    layer: "lib",
    icon: "🤖",
    summary_he:
      "קוראת analyzeAndDecide מקבלת קריאות חיישן + actions + tasks + tolerance + bottle status + diurnal context, בונה user-prompt עשיר, שולחת ל-Claude Sonnet 4.6 עם cached SYSTEM_PROMPT, מחזירה JSON עם actions / tasks / status / next_check_minutes.",
    files: ["src/lib/brain.ts", "src/lib/prompt-engine.ts"],
    concepts: [
      {
        he: "Cached SYSTEM_PROMPT",
        detail:
          "ה-prompt הגדול (כ-2K טוקנים) מסומן cacheControl: ephemeral, ttl: 1h — חוסך ~80% מטוקני input אחרי הסבב הראשון.",
      },
      {
        he: "Windowed statistics",
        detail:
          "המוח לא רואה raw readings — הוא רואה median+σ+trend לכל מטריקה בחלונות 5min/1h/6h/24h.  מאלץ אותו לחשוב על drift אמיתי במקום על קריאה בודדת.",
      },
      {
        he: "Bands + diurnal",
        detail:
          "כל מחזור מקבל את ה-tolerance band + diurnal context.  המוח יודע 'pH 6.4 ב-14:00 = within band בשיא הפוטוסינתזה — לא נוגעים'.",
      },
      {
        he: "Validation",
        detail:
          "כל action שהמוח מחזיר עובר ב-validateCommand של ה-safety controller לפני שמתבצע.  המוח לא יכול לעקוף.",
      },
    ],
    depends_on: ["prompt-engine", "tolerance", "bottle-status", "priming", "dosing-config"],
    produces_for: ["safety", "cron-cycle"],
  },
  {
    id: "prompt-engine",
    title_he: "Prompt Engine",
    title_en: "Prompt engine — system + user prompt builders",
    layer: "lib",
    icon: "📝",
    summary_he:
      "SYSTEM_PROMPT הגלובלי (יציב, נשמר בקאש) + buildUserPrompt דינמי שמרכיב לכל מחזור: stats, system instance, execution authority, fertilizer + channels, priming, tolerance bands, diurnal, recent actions, pending tasks, time context.",
    files: ["src/lib/prompt-engine.ts"],
    concepts: [
      {
        he: "סעיף 'Dead-band controller'",
        detail:
          "חוק מפורש: within band → לא להציע תיקון.  4 קריטריונים שבלעדיהם המוח לא מציע מנה.",
      },
      {
        he: "Execution Authority section",
        detail:
          "כל prompt מציין autonomous_dosing_enabled + doser_verified + bottle inventory.  אם autonomous=false, מוסיף הנחיה 'הצעותיך יהפכו ל-tasks, היה שמרני'.",
      },
    ],
    depends_on: [],
    produces_for: ["brain"],
  },
  {
    id: "tolerance",
    title_he: "Dead-band Controller",
    title_en: "Tolerance bands + diurnal awareness",
    layer: "control",
    icon: "🎯",
    summary_he:
      "טווח יעד עם סבילות לכל מטריקה (pH/EC/temp).  בתוך הבאנד = 'נורמלי, אל תיגע'.  שולט גם ב-cycle-gate (חוסם רעש) וגם ב-brain prompt (חוקי החלטה).  מודעות יומית לפוטוסינתזה ולפעילות לילית.",
    files: ["src/lib/tolerance.ts"],
    concepts: [
      {
        he: "CROP_DEFAULTS",
        detail:
          "טבלת yedef × stage לכל גידול נתמך.  בזיליקום וגטטיבי: pH 6.0±0.4, EC 1900±15%, מים 22°C±4.  אפשר לעקוף ב-systems.target_ranges JSONB.",
      },
      {
        he: "evaluateMetric → within | edge | outside",
        detail:
          "within = |distance| ≤ band, edge = 1-1.5 bands, outside = >1.5 bands.  גם ה-cycle-gate וגם ה-prompt משתמשים באותה פונקציה.",
      },
      {
        he: "Diurnal phases",
        detail:
          "morning-ramp-up / peak-photosynthesis / afternoon-wind-down / night-respiration — ה-prompt מקבל hint על מה צפוי בשעה הנוכחית כדי לא להגיב לקצב הטבעי.",
      },
    ],
    depends_on: [],
    produces_for: ["cycle-gate", "brain", "prompt-engine"],
  },
  {
    id: "safety",
    title_he: "Safety Controller",
    title_en: "Safety controller (hard guard-rails)",
    layer: "safety",
    icon: "🛡️",
    summary_he:
      "שכבה אחרונה לפני המשאבה.  validateCommand מאמת כל מנה: גבולות pH/EC/temp, רעננות חיישן, רמת בקבוק, daily-total cap, hourly cap, min-interval.  לא ניתן לעקיפה מ-LLM.",
    files: ["src/lib/safety.ts"],
    concepts: [
      {
        he: "Hard bounds",
        detail:
          "pH 4.5-8.0 absolute, EC 100-3500, מים 5-35°C, max 50ml/מנה, 150ml/שעה/ערוץ, 60s interval בין מנות.",
      },
      {
        he: "Daily total cap",
        detail:
          "pre-verify: 30ml/24h.  verified: 250ml/24h.  עוצר runaway-dosing ברמת המערכת.",
      },
      {
        he: "Bottle floor 15ml",
        detail:
          "אם רמת בקבוק מתחת ל-MIN_BOTTLE_ML_TO_DOSE → דחייה.  גם אם המנה תוריד אותו מתחת לרצפה.",
      },
      {
        he: "is_priming flag",
        detail:
          "פטור מ-interval / hourly לא דרך reason-text (זה הבאג של POC v02) אלא דרך command.is_priming + ai_status='priming' שנקבעים בצד-שרת בלבד.",
      },
    ],
    depends_on: ["dosing-config"],
    produces_for: ["execute-dose", "prime-channel"],
  },
  {
    id: "dosing-config",
    title_he: "Dosing Config + פרופילי דשן",
    title_en: "Per-system dosing config + fertilizer profiles",
    layer: "lib",
    icon: "🧪",
    summary_he:
      "מערכת רב-דשנים: לכל מערכת יש profile_id + assignments (channel-key → role + physical channel + component_key).  Roles: fertilizer / ph_up / ph_down.  פרופילים נתמכים: Terra Aquatica Tri Part, LivinGreen המושלם.",
    files: ["src/lib/dosing-config.ts", "src/lib/fertilizer-profiles.ts"],
    concepts: [
      {
        he: "Channel resolver",
        detail:
          "getDosingConfig(systemId) → DosingConfig.  doseChannelByPhysical מקבל physical channel מהתצורה — לא יותר hardcoded CHANNEL_MAP.",
      },
      {
        he: "pH up + pH down conditional",
        detail:
          "מערכת יכולה להיות עם אחד / שניהם / אף אחד.  safety מסתעף לפי מה שמותקן.",
      },
      {
        he: "FertilizerProfile registry",
        detail:
          "כל פרופיל מכיל components + stage_ratios + ml_per_50us_per_60L.  קל להוסיף profile חדש בלי לגעת ב-safety/brain.",
      },
    ],
    depends_on: [],
    produces_for: ["brain", "safety", "execute-dose"],
  },
  {
    id: "priming",
    title_he: "Priming Tracker",
    title_en: "Priming state (tube fill detection)",
    layer: "lib",
    icon: "🩸",
    summary_he:
      "כל ערוץ צריך מילוי ראשוני (~8ml) לפני שמנה תגיע למאגר.  המעקב מבוסס על ai_status='priming' (server-controlled, לא reason-text).  המוח רואה אילו ערוצים עדיין UNPRIMED ולא מסיק מסקנות מהמנה הראשונה.",
    files: ["src/lib/priming.ts"],
    concepts: [
      {
        he: "Detection by ai_status",
        detail:
          "אחרי הבאג ב-v0.2 בו המוח כתב 'priming' ב-reason באנגלית ועקף בטיחות — הבדיקה עברה ל-ai_status שנכתב בצד-שרת ב-primeChannel/runDoserProtocol בלבד.",
      },
      {
        he: "Exempt from rate limits",
        detail:
          "מנות priming לא נספרות בכלל ב-min-interval / hourly cap / daily total.  הן בכלל לא מנות אגרונומיות, רק מילוי טכני.",
      },
    ],
    depends_on: ["dosing-config"],
    produces_for: ["brain", "safety"],
  },
  {
    id: "bottle-status",
    title_he: "Bottle Status + תחזיות",
    title_en: "Bottle inventory + days-until-empty forecast",
    layer: "lib",
    icon: "🍼",
    summary_he:
      "לכל ערוץ: capacity (מקור), remaining (נוכחי), צריכה 7 ימים, ממוצע יומי, ימים-עד-ריק, status (ok/low/near_empty/empty), verified_at.  מוזרק ל-prompt ול-UI דרך אותה פונקציה.",
    files: ["src/lib/bottle-status.ts", "src/lib/db.ts"],
    concepts: [
      {
        he: "declareBottleLevels (fill mode)",
        detail:
          "המגדל מצהיר על מילוי → capacity + remaining שניהם נכתבים לאותו ערך, verified_at מקבל חותמת.",
      },
      {
        he: "verifyBottleLevels (visual)",
        detail:
          "המגדל מסתכל על הבקבוק ומדווח.  המערכת משווה ל-tracked ומחזירה דלתא + flag (ok/minor/major).  major → דיון על הסיבה (דליפה, משאבה לא מכוילת, מנה לא רשומה).",
      },
      {
        he: "Effectiveness inference",
        detail:
          "צריכה לפי action log (מחריג priming + doser_protocol).  daily_avg מחושב לפי הטווח הנצפה (לפחות יום אחד).",
      },
    ],
    depends_on: ["dosing-config"],
    produces_for: ["brain", "bottle-levels-ui", "safety"],
  },
  {
    id: "execute-dose",
    title_he: "Execute Dose / Prime Channel",
    title_en: "Pump-firing primitives (chat + cron)",
    layer: "server",
    icon: "🎯",
    summary_he:
      "doseChannelByPhysical(physical, ml, reason, channelKey) — מפעיל את המשאבה, מחכה למשך זמן, מכבה.  Wrappers: executeDose (chat, treatment), primeChannel + primeAllChannels (chat, priming), /api/dose/test, /api/dose/prime, ה-cron /cycle.",
    files: ["src/lib/devices/jebao.ts", "src/lib/agent-tools.ts", "src/app/api/dose/test/route.ts", "src/app/api/dose/prime/route.ts"],
    concepts: [
      {
        he: "executeDose — chat-driven treatment",
        detail:
          "is_priming=false, decrementBottle אחרי הצלחה, logging ב-ai_status='chat'.",
      },
      {
        he: "primeChannel — chat-driven tube fill",
        detail:
          "is_priming=true, מדלג על interval/hourly cap, מסמן ai_status='priming' כדי שpriming-state יזהה.",
      },
      {
        he: "runDoserProtocol — verification chain",
        detail:
          "prime כל ערוץ unprimed + 1ml אימות מכל ערוץ.  ai_status='doser_protocol'.  מסיים בקריאה למגדל לאמת ויזואלית.",
      },
    ],
    depends_on: ["safety", "dosing-config", "priming"],
    produces_for: ["jebao-pump", "bottle-status"],
  },
  {
    id: "chat-route",
    title_he: "Chat Agent — שיחת AI",
    title_en: "/api/chat — chat agent with tools",
    layer: "server",
    icon: "💬",
    summary_he:
      "AI SDK + Claude Sonnet 4.6 + tool-use.  מקבל messages, מזהה מצב מערכת (fresh / paused / setup-complete), מזריק system-prompt מותאם, מספק לסוכן 15+ כלים.  Streaming → toUIMessageStreamResponse → ה-UI.",
    files: ["src/app/api/chat/route.ts", "src/lib/agent-tools.ts"],
    concepts: [
      {
        he: "Tool catalog",
        detail:
          "getCurrentState, pollSensorNow, executeDose, proposeAction, askGrower, updateSystem, configureFertilizer, listFertilizerProfiles, declareBottleLevels, verifyBottleLevels, getBottleStatus, markSetupComplete, markDoserVerified, primeChannel, primeAllChannels, runDoserProtocol, requestObservation, getPrimingStatus, getRecentReadings, getRecentDecisions, getPendingTasks.",
      },
      {
        he: "Confirmation discipline",
        detail:
          "כלל מפורש: אישור אחד = תוכנית שלמה.  לא לשאול 'מאשר?' בין sub-steps.",
      },
      {
        he: "Execution model",
        detail:
          "stateless בין תורים, 60s timeout, NO autonomous returns.  אם waiting > 45s → לסיים תור ולהגיד למגדל מה לכתוב.",
      },
      {
        he: "Onboarding flow",
        detail:
          "6 שאלות פתוחות (שם/גידול/שלב/נפח/מיקום/הערות) → markSetupComplete → declareBottleLevels → runDoserProtocol → verifyBottleLevels → markDoserVerified → המגדל מדליק autonomous דרך UI.",
      },
    ],
    depends_on: ["brain", "execute-dose", "bottle-status", "tolerance", "priming"],
    produces_for: ["chat-ui", "chat-history"],
  },
  {
    id: "chat-history",
    title_he: "Chat History (persistence)",
    title_en: "chat_messages table + history endpoint",
    layer: "server",
    icon: "🗂️",
    summary_he:
      "כל הודעת user/assistant נשמרת ב-chat_messages עם system_id + thread_id.  הודעות cron-pushed (cycle / daily) נכנסות לאותה טבלה עם source-tag שונה.  ה-UI טוען historic-on-mount ומשתלב עם useChat.",
    files: ["src/lib/db.ts (chat_messages)", "src/app/api/chat/history/route.ts"],
    concepts: [
      {
        he: "onFinish callback",
        detail:
          "result.toUIMessageStreamResponse({ onFinish }) שומר את ההודעה הסופית של הסוכן אחרי שהסטרים נגמר.",
      },
      {
        he: "History trim 40 turns",
        detail:
          "Server מצמצם ל-40 turns אחרונים לפני שליחה ל-Claude — ה-DB עדיין שומר הכל, רק מה ש-prompt רואה מוגבל.",
      },
    ],
    depends_on: [],
    produces_for: ["chat-ui"],
  },
  {
    id: "tasks",
    title_he: "Human Task Queue",
    title_en: "human_tasks + approval/complete/dismiss endpoints",
    layer: "server",
    icon: "📋",
    summary_he:
      "המקום שבו מצטברות בקשות אל המגדל.  שני סוגים: dose_approval (אישור מנה — לחיצה תפעיל משאבה ב-/approve endpoint) ושאר (water_change/manual_action/system_reset/question — לחיצה רק מסמנת done).",
    files: ["src/lib/db.ts (human_tasks)", "src/app/api/tasks/[id]/*/route.ts"],
    concepts: [
      {
        he: "Approve endpoint",
        detail:
          "POST /api/tasks/[id]/approve על dose_approval task: שולף payload (channel + ml), מעביר ב-safety, יורה משאבה, מסמן done.  זה התיקון לבאג בו 'בוצע' לא היה באמת מבצע.",
      },
      {
        he: "Dose proposals from cron",
        detail:
          "כש-autonomous=false, cron-cycle לא יורה אלא יוצר dose_approval task לכל פקודה.",
      },
    ],
    depends_on: ["execute-dose", "safety"],
    produces_for: ["tasks-badge", "dashboard"],
  },
  {
    id: "db",
    title_he: "Neon Postgres — שכבת נתונים",
    title_en: "Neon Postgres via @neondatabase/serverless",
    layer: "lib",
    icon: "💾",
    summary_he:
      "טבלאות: systems, sensor_readings, ai_decisions, dosing_actions, human_tasks, chat_messages.  סכמה נטענת ידנית באמצעות ensureSchema() עם safeDdl שמטפל במירוץ בין cold-starts.",
    files: ["src/lib/db.ts"],
    concepts: [
      {
        he: "systems schema",
        detail:
          "20+ עמודות שמתפתחות תוך כדי: status, crop, growth_stage, reservoir, dosing_config, next_check_at, setup_completed_at, autonomous_dosing_enabled, doser_verified, bottle_levels, bottle_capacities, bottle_verified_at, target_ranges.",
      },
      {
        he: "Additive migrations",
        detail:
          "כל עמודה חדשה מוסיפה כ-ALTER TABLE ... ADD COLUMN IF NOT EXISTS.  ensureSchema() רץ באופן עצלן בקריאה הראשונה לכל function.",
      },
    ],
    depends_on: [],
    produces_for: ["brain", "safety", "chat-route", "tasks", "bottle-status"],
  },
  {
    id: "chat-ui",
    title_he: "Chat UI",
    title_en: "/chat page — chat interface",
    layer: "ui",
    icon: "💭",
    summary_he:
      "מסך השיחה (/chat).  useChat hook של AI SDK + DefaultChatTransport.  טוען היסטוריה ב-mount, מציג fresh-system CTA או starters רגילים.  Streaming responses, tool-call rendering, StackedQuestion על askGrower.",
    files: ["src/app/chat/page.tsx", "src/components/StackedQuestion.tsx"],
    concepts: [
      {
        he: "Fresh-system detection",
        detail:
          "אם שם='מערכת חדשה' + 0 readings + 0 decisions → empty-state עם 'התחל הקמה' CTA שמכניס kickoff message שמפעיל את ה-onboarding.",
      },
      {
        he: "Cron-pushed messages",
        detail:
          "הודעות מ-cron-cycle / cron-daily מוצגות בקלפים מתקפלים עם source-tag.  אפשר ללחוץ להרחיב את ה-reasoning המלא.",
      },
    ],
    depends_on: ["chat-route", "chat-history"],
    produces_for: ["grower"],
    ux_note_he:
      "השיחה היא הפרינסיפ — לא דשבורד מבוסס-מטריקות.  Conversational AI agronomist > metrics-card dashboard.",
  },
  {
    id: "dashboard",
    title_he: "Dashboard (/)",
    title_en: "/ — operational metrics dashboard (home)",
    layer: "ui",
    icon: "📊",
    summary_he:
      "כרטיסי מטריקות (pH/EC/temp/ORP/TDS/salinity/SG/CF), גרף חיישנים, BottleLevels, ניתוח אחרון, מצב agent, ושני בלוקי משימות נפרדים: 'ממתין לאישור שלך' + 'צריך ידיים שלך'.",
    files: ["src/app/page.tsx", "src/components/SensorChart.tsx", "src/components/BottleLevels.tsx"],
    concepts: [
      {
        he: "Split tasks panel",
        detail:
          "dose_approval (lime) נפרד מ-manual_action/water_change/system_reset/question (blue).  כל קלף עם action ראשי + dismiss.",
      },
      {
        he: "Bottle levels card",
        detail:
          "לכל ערוץ: bar לפי %, ml/cap, צריכה 7 ימים, ממוצע יומי, ימים-עד-ריק, recheck-overdue tag.  מתרענן כל 30 שניות.",
      },
    ],
    depends_on: ["tasks", "bottle-status"],
    produces_for: ["grower"],
  },
  {
    id: "nav",
    title_he: "Nav + ה-toggles",
    title_en: "Nav bar — global state toggles",
    layer: "ui",
    icon: "🧭",
    summary_he:
      "Top bar עם SystemSwitcher, StatusChip, MaintenanceToggle, AutonomousToggle, TasksBadge.  כל אחד עצמאי, מתרענן בנפרד.  זמין בכל הדפים.",
    files: ["src/components/Nav.tsx", "src/components/AutonomousToggle.tsx", "src/components/TasksBadge.tsx", "src/components/SystemSwitcher.tsx", "src/components/MaintenanceToggle.tsx", "src/components/StatusChip.tsx"],
    concepts: [
      {
        he: "AutonomousToggle",
        detail:
          "Master safety switch.  מציג 3 מצבים: 🟢 אוטונומי / 🟠 ידני (verified) / ⚪ ידני (unverified, disabled).  refuses להפעיל ללא doser_verified=true.",
      },
      {
        he: "TasksBadge",
        detail:
          "ספירות מובחנות 'לאישור' (dose_approval, ירוק) ו'פיזי' (השאר, כחול).  מתחדש כל 15 שניות.  נעלם כשאין כלום.",
      },
    ],
    depends_on: ["tasks"],
    produces_for: ["grower"],
  },
  {
    id: "grower",
    title_he: "המגדל",
    title_en: "The grower (you)",
    layer: "user",
    icon: "👤",
    summary_he:
      "המקור היחיד של אישורים פיזיים, מילוי בקבוקים, הפעלת autonomous.  הסוכן יכול לעבוד 24/7 — אבל כל החלטה consequential עוברת דרך המגדל.",
    files: [],
    concepts: [
      {
        he: "Trust model",
        detail:
          "המערכת מתחילה shut-down (autonomous=false, doser=unverified, bottles=undeclared).  המגדל פותח כל שכבת אמון בצעד מפורש.",
      },
      {
        he: "Conversational primary",
        detail:
          "הצ'אט הוא הממשק הראשי, לא הדשבורד.  הדשבורד הוא reference / approval flow.",
      },
    ],
    depends_on: ["chat-ui", "dashboard", "nav"],
    produces_for: ["chat-route"],
  },
];

// Palette-only category accents (no rainbow): the 4 accents + amber + a couple
// of neutrals, assigned by meaning. safety = terra (the negative), control =
// basil (the Brain), the rest spread across mineral/moss/amber/neutral. The
// label carries the real distinction; the colour is a quiet accent.
const LAYER_LABELS: Record<Block["layer"], { he: string; color: string }> = {
  hw:      { he: "חומרה",        color: "var(--amber)" },
  cloud:   { he: "ענן צד שלישי",  color: "var(--c-stone)" },
  server:  { he: "שירותי שרת",    color: "var(--c-mineral)" },
  lib:     { he: "ספריות-Domain", color: "var(--c-moss)" },
  control: { he: "שכבת בקרה",     color: "var(--c-basil)" },
  safety:  { he: "בקרת בטיחות",   color: "var(--c-terra)" },
  ui:      { he: "ממשק משתמש",    color: "var(--c-fog)" },
  user:    { he: "המגדל",         color: "var(--amber)" },
};
/** Inline style for a category chip/card from its palette colour. */
function layerStyle(c: string): React.CSSProperties {
  return { borderColor: c, background: `color-mix(in srgb, ${c} 12%, transparent)` };
}

export default function ArchitecturePage() {
  // IP protection: this page documents how TELOS is built. It is off in the
  // customer-facing app — only reachable when the team sets
  // NEXT_PUBLIC_SHOW_ARCHITECTURE=1. Otherwise the URL bounces home.
  if (process.env.NEXT_PUBLIC_SHOW_ARCHITECTURE !== "1") redirect("/");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = useMemo(() => Object.fromEntries(BLOCKS.map((b) => [b.id, b])), []);
  const byLayer = useMemo(() => {
    const out: Record<Block["layer"], Block[]> = {
      hw: [], cloud: [], server: [], lib: [], control: [], safety: [], ui: [], user: [],
    };
    for (const b of BLOCKS) out[b.layer].push(b);
    return out;
  }, []);

  const selected = selectedId ? byId[selectedId] : null;

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 space-y-6" dir="rtl">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">ארכיטקטורת Telos</h1>
        <p className="text-[var(--c-ash)] text-sm leading-relaxed max-w-3xl">
          מפת המערכת המלאה — חומרה, ענן, שירותי שרת, מוח AI, שכבות בקרה ובטיחות,
          ממשק משתמש.  לחיצה על כל בלוק תפתח פאנל מפורט עם קונספטים מרכזיים,
          קבצים רלוונטיים, ותלויות.
        </p>
      </header>

      {/* Top-level flow diagram */}
      <section className="bg-[var(--surface-warm)] rounded-xl p-5 border border-[rgba(238,237,232,0.08)]">
        <h2 className="font-semibold mb-3">תרשים זרימה ברמת-על</h2>
        <FlowDiagram onSelect={setSelectedId} />
      </section>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        {/* Layers */}
        <section className="space-y-5">
          {(Object.keys(byLayer) as Block["layer"][]).map((layer) =>
            byLayer[layer].length === 0 ? null : (
              <div key={layer}>
                <div className="flex items-baseline gap-2 mb-2">
                  <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--c-ash)]">
                    {LAYER_LABELS[layer].he}
                  </h2>
                  <span className="text-xs text-[var(--c-stone)]">
                    ({byLayer[layer].length})
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {byLayer[layer].map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedId(b.id)}
                      style={layerStyle(LAYER_LABELS[layer].color)}
                      className={`text-right p-3 rounded-lg border-2 transition-all hover:scale-[1.01] hover:shadow ${
                        selectedId === b.id ? "ring-2 ring-offset-1 ring-[var(--c-parchment)]" : ""
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg">{b.icon}</span>
                        <span className="font-medium text-sm flex-1">{b.title_he}</span>
                      </div>
                      <p className="text-xs text-[var(--c-ash)] mt-1 leading-snug line-clamp-2">
                        {b.summary_he}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </section>

        {/* Detail panel */}
        <aside className="lg:sticky lg:top-20 bg-[var(--surface-warm)] rounded-xl p-5 border border-[rgba(238,237,232,0.08)] max-h-[calc(100vh-6rem)] overflow-y-auto">
          {!selected ? (
            <div className="text-sm text-[var(--c-ash)] leading-relaxed">
              <p className="mb-2">לחץ על בלוק כדי להציג כאן את הפרטים המלאים שלו.</p>
              <ul className="text-xs space-y-1 text-[var(--c-stone)]">
                <li>📐 קונספטים מרכזיים + הסבר טכני קצר על כל אחד</li>
                <li>📁 הקבצים הרלוונטיים בפועל</li>
                <li>🔗 תלויות ותפוקות (אילו בלוקים מזינים את זה ולמי הוא מזין)</li>
                <li>⚠️ Gotchas / lessons learned</li>
              </ul>
            </div>
          ) : (
            <DetailPanel block={selected} byId={byId} onSelect={setSelectedId} />
          )}
        </aside>
      </div>

      <footer className="text-xs text-[var(--c-stone)] text-center pt-4 border-t border-[rgba(238,237,232,0.08)]">
        Architecture as of v0.3 • {BLOCKS.length} blocks • לחץ + לאיתחול הבחירה
      </footer>
    </main>
  );
}

/** Top-of-page flow lozenge: 7 horizontal stages with arrows. */
function FlowDiagram({ onSelect }: { onSelect: (id: string) => void }) {
  const STAGES: Array<{ id: string; label_he: string; icon: string }> = [
    { id: "tuya-sensor", label_he: "חיישנים", icon: "🌡️" },
    { id: "cron-poll", label_he: "Poll 5min", icon: "📡" },
    { id: "cycle-gate", label_he: "Cycle Gate", icon: "🚦" },
    { id: "brain", label_he: "Brain", icon: "🤖" },
    { id: "safety", label_he: "Safety", icon: "🛡️" },
    { id: "execute-dose", label_he: "Dose", icon: "🎯" },
    { id: "jebao-pump", label_he: "Pumps", icon: "💧" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
      {STAGES.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <button
            onClick={() => onSelect(s.id)}
            className="px-3 py-2 rounded-lg border-2 border-[var(--c-bark)] bg-[var(--surface-warm)] hover:border-[var(--c-basil)] transition-colors text-sm font-medium flex items-center gap-1.5"
          >
            <span>{s.icon}</span>
            <span>{s.label_he}</span>
          </button>
          {i < STAGES.length - 1 && (
            <span className="px-1 text-[var(--c-stone)] text-lg" aria-hidden="true">
              ←
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function DetailPanel({
  block,
  byId,
  onSelect,
}: {
  block: Block;
  byId: Record<string, Block>;
  onSelect: (id: string) => void;
}) {
  return (
    <article className="space-y-4 text-sm">
      <header>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl">{block.icon}</span>
          <h2 className="text-lg font-bold">{block.title_he}</h2>
        </div>
        <p className="text-xs text-[var(--c-ash)] mt-0.5" dir="ltr">{block.title_en}</p>
        <span
          className="inline-block mt-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border"
          style={layerStyle(LAYER_LABELS[block.layer].color)}
        >
          {LAYER_LABELS[block.layer].he}
        </span>
      </header>

      <section>
        <h3 className="font-semibold text-[var(--c-fog)] mb-1">תקציר</h3>
        <p className="text-[var(--c-fog)] dark:text-[var(--c-stone)] leading-relaxed">
          {block.summary_he}
        </p>
      </section>

      {block.concepts.length > 0 && (
        <section>
          <h3 className="font-semibold text-[var(--c-fog)] mb-1">קונספטים</h3>
          <ul className="space-y-2">
            {block.concepts.map((c) => (
              <li key={c.he} className="border-r-2 border-[var(--c-basil)] pr-3 py-0.5">
                <div className="font-medium text-xs text-[var(--c-basil)]">
                  {c.he}
                </div>
                <div className="text-xs text-[var(--c-fog)] dark:text-[var(--c-stone)] leading-relaxed mt-0.5">
                  {c.detail}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {block.files.length > 0 && (
        <section>
          <h3 className="font-semibold text-[var(--c-fog)] mb-1">קבצים</h3>
          <ul className="space-y-1">
            {block.files.map((f) => (
              <li
                key={f}
                className="text-[11px] font-mono bg-[var(--c-bark)] rounded px-2 py-1"
                dir="ltr"
              >
                {f}
              </li>
            ))}
          </ul>
        </section>
      )}

      {block.depends_on.length > 0 && (
        <section>
          <h3 className="font-semibold text-[var(--c-fog)] mb-1">תלוי ב</h3>
          <div className="flex flex-wrap gap-1">
            {block.depends_on.map((id) => {
              const target = byId[id];
              if (!target) return null;
              return (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className="text-[11px] px-2 py-0.5 rounded bg-[var(--c-bark)] hover:bg-[color-mix(in_srgb,var(--c-basil)_22%,transparent)] transition-colors"
                >
                  {target.icon} {target.title_he}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {block.produces_for.length > 0 && (
        <section>
          <h3 className="font-semibold text-[var(--c-fog)] mb-1">מזין ל</h3>
          <div className="flex flex-wrap gap-1">
            {block.produces_for.map((id) => {
              const target = byId[id];
              if (!target) return null;
              return (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className="text-[11px] px-2 py-0.5 rounded bg-[var(--c-bark)] hover:bg-[color-mix(in_srgb,var(--c-mineral)_30%,transparent)] transition-colors"
                >
                  {target.icon} {target.title_he}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {block.gotchas_he && block.gotchas_he.length > 0 && (
        <section>
          <h3 className="font-semibold text-[var(--c-fog)] mb-1">⚠️ Gotchas</h3>
          <ul className="space-y-1">
            {block.gotchas_he.map((g, i) => (
              <li
                key={i}
                className="text-xs text-[var(--c-fog)] bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] border border-[color-mix(in_srgb,var(--amber)_30%,transparent)] rounded p-2 leading-relaxed"
              >
                {g}
              </li>
            ))}
          </ul>
        </section>
      )}

      {block.ux_note_he && (
        <section>
          <h3 className="font-semibold text-[var(--c-fog)] mb-1">💡 UX Note</h3>
          <p className="text-xs text-[var(--c-fog)] bg-[color-mix(in_srgb,var(--c-mineral)_14%,transparent)] border border-[color-mix(in_srgb,var(--c-mineral)_30%,transparent)] rounded p-2 leading-relaxed">
            {block.ux_note_he}
          </p>
        </section>
      )}
    </article>
  );
}
