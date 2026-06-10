/**
 * Change Log — the grower-facing record of capabilities TELOS has gained over
 * time. A curated, committed list (NOT auto-generated from git: commit messages
 * carry internal names, file paths, and the Co-Authored-By trailer — none of
 * which may reach a grower-facing page).
 *
 * IP RULE for every entry: describe the OUTCOME for the grower — what it does
 * for them and why it helps — NEVER how it is built (no model/vendor, no
 * "cycle gate", "allowlist mapper", "reconciler", DB, prompt, or rule names).
 * Audit each new entry against web/src/brand/voice.ts (the confidentiality
 * stance) before committing.
 */

export type ChangeLogCategory =
  | "autonomy"
  | "intelligence"
  | "collaboration"
  | "visibility"
  | "control"
  | "connectivity";

export type ChangeLogEntry = {
  id: string;
  /** Short name (en, he). */
  title: [string, string];
  /** The essence — what it IS, in outcome terms (en, he). */
  what: [string, string];
  /** The benefit — why it helps the grower (en, he). */
  benefit: [string, string];
  /** Phosphor (ph-light) icon name. */
  icon: string;
  category: ChangeLogCategory;
};

export const CHANGELOG_CATEGORY: Record<ChangeLogCategory, { label: [string, string]; color: string }> = {
  autonomy: { label: ["Autonomy", "אוטונומיה"], color: "var(--c-basil)" },
  intelligence: { label: ["Intelligence", "אינטליגנציה"], color: "var(--c-mineral)" },
  collaboration: { label: ["Collaboration", "שיתוף"], color: "var(--amber)" },
  visibility: { label: ["Visibility", "נראוּת"], color: "var(--c-mineral)" },
  control: { label: ["Control", "שליטה"], color: "var(--amber)" },
  connectivity: { label: ["Connectivity", "קישוריות"], color: "var(--c-terra)" },
};

/**
 * Newest first. Order is the timeline; entries are intentionally undated until
 * real release dates are confirmed (placeholder dates on a live calendar read as
 * broken). Add new capabilities at the TOP.
 */
export const CHANGELOG: ChangeLogEntry[] = [
  {
    id: "one-plan-everywhere",
    title: ["One plan, everywhere", "תוכנית אחת, בכל מקום"],
    what: [
      "Your harvest date and next action come from a single source.",
      "תאריך הקטיף והפעולה הבאה נשענים על מקור אחד.",
    ],
    benefit: [
      "Move the harvest in chat and the dashboard, the grow page and the timeline all agree at once — no more conflicting dates.",
      "מזיזים את הקטיף בצ'אט — והדשבורד, עמוד הגידול וציר הזמן מתעדכנים יחד מיד, בלי תאריכים סותרים.",
    ],
    icon: "ph-target",
    category: "visibility",
  },
  {
    id: "grow-timeline",
    title: ["Grow timeline", "ציר הגידול"],
    what: [
      "A timeline of what's ahead and everything that already happened to your grow.",
      "ציר זמן של מה שלפנינו וכל מה שכבר קרה לגידול.",
    ],
    benefit: [
      "See the plan and review every action — yours and TELOS's — at a glance.",
      "לראות את התוכנית ולתחקר כל פעולה — שלך ושל TELOS — במבט אחד.",
    ],
    icon: "ph-clock-countdown",
    category: "visibility",
  },
  {
    id: "harvest-planning",
    title: ["Planned harvest", "קטיף מתוכנן"],
    what: [
      "An optimal harvest date planned ahead, with a heads-up and exact picking instructions.",
      "תאריך קטיף אופטימלי מתוכנן מראש, עם תזכורת והנחיות קטיף מדויקות.",
    ],
    benefit: [
      "Pick at peak quality, prepared — and adjust the date whenever you need.",
      "לקטוף בשיא האיכות, מוכנים — ולהזיז את התאריך מתי שצריך.",
    ],
    icon: "ph-scissors",
    category: "intelligence",
  },
  {
    id: "quieter-when-well",
    title: ["Quieter when all is well", "שקט כשהכל תקין"],
    what: [
      "TELOS speaks up only when your grow actually needs you.",
      "TELOS פונה אליך רק כשהגידול באמת זקוק לך.",
    ],
    benefit: [
      "No noise on calm days; a clear nudge when something matters.",
      "בלי רעש בימים רגועים; התראה ברורה כשמשהו חשוב.",
    ],
    icon: "ph-bell-simple",
    category: "control",
  },
  {
    id: "day-night-care",
    title: ["Day-and-night aware care", "טיפול שמודע ליום ולילה"],
    what: [
      "TELOS expects readings to drift with the sun and the plant's daily rhythm.",
      "TELOS יודע שהקריאות נעות עם השמש והקצב היומי של הצמח.",
    ],
    benefit: [
      "It corrects real problems instead of chasing normal daily swings.",
      "הוא מתקן בעיות אמיתיות במקום לרדוף אחרי תנודות יומיות רגילות.",
    ],
    icon: "ph-sun-horizon",
    category: "intelligence",
  },
  {
    id: "cultivar-intelligence",
    title: ["Cultivar intelligence", "אינטליגנציית זן"],
    what: [
      "Care tuned to your exact cultivar — its stress signs and quality markers.",
      "טיפול מותאם לזן המדויק שלך — סימני הסטרס וסמני האיכות שלו.",
    ],
    benefit: [
      "Guidance specific to what you're growing, not generic plant advice.",
      "הנחיה ספציפית למה שאתה מגדל, לא עצה כללית על צמחים.",
    ],
    icon: "ph-plant",
    category: "intelligence",
  },
  {
    id: "safety-guardrails",
    title: ["Safety guardrails", "מעקות בטיחות"],
    what: [
      "Every dose stays within safe limits, with steady, gradual correction.",
      "כל מנה נשארת בגבולות בטוחים, עם תיקון יציב והדרגתי.",
    ],
    benefit: [
      "No overshoot, no wasted nutrients, no empty bottles overnight.",
      "בלי חריגה, בלי בזבוז דשן, בלי בקבוקים ריקים בבוקר.",
    ],
    icon: "ph-shield-check",
    category: "control",
  },
  {
    id: "dosing-guidance",
    title: ["Hands-on dosing guidance", "הנחיית מינון ידנית"],
    what: [
      "Clear, exact steps when you choose to dose by hand.",
      "צעדים ברורים ומדויקים כשאתה בוחר לדשן ידנית.",
    ],
    benefit: [
      "Know precisely what to add and when — TELOS confirms it landed.",
      "לדעת בדיוק מה להוסיף ומתי — ו-TELOS מוודא שזה נקלט.",
    ],
    icon: "ph-eyedropper",
    category: "collaboration",
  },
  {
    id: "always-on-chat",
    title: ["Always-on chat", "צ'אט תמידי"],
    what: [
      "Ask TELOS anything about your grow, any time, in your language.",
      "לשאול את TELOS כל דבר על הגידול, בכל זמן, בשפה שלך.",
    ],
    benefit: [
      "A grower's second opinion on call — and it remembers what you teach it.",
      "חוות דעת שנייה זמינה — וזוכרת את מה שאתה מלמד אותה.",
    ],
    icon: "ph-chat-circle",
    category: "collaboration",
  },
  {
    id: "live-dashboard",
    title: ["Live sensor dashboard", "דשבורד חיישנים חי"],
    what: [
      "Your pH, EC and water temperature, live, with recent trends.",
      "ה-pH, ה-EC וטמפרטורת המים שלך, חי, עם מגמות אחרונות.",
    ],
    benefit: [
      "Know the state of your reservoir at a glance, from anywhere.",
      "לדעת את מצב המאגר במבט אחד, מכל מקום.",
    ],
    icon: "ph-gauge",
    category: "visibility",
  },
  {
    id: "bottle-forecast",
    title: ["Bottle inventory forecast", "תחזית מלאי בקבוקים"],
    what: [
      "TELOS tracks how much is left in each bottle and how long it lasts.",
      "TELOS עוקב כמה נשאר בכל בקבוק ולכמה זמן יספיק.",
    ],
    benefit: [
      "Refill before you run dry — never get caught mid-grow.",
      "למלא לפני שנגמר — בלי להיתפס באמצע הגידול.",
    ],
    icon: "ph-flask",
    category: "control",
  },
  {
    id: "daily-summary",
    title: ["Daily summary", "סיכום יומי"],
    what: [
      "A short morning read on how your grow is doing.",
      "קריאה קצרה בבוקר על שלום הגידול.",
    ],
    benefit: [
      "Start the day knowing what changed and what, if anything, needs you.",
      "להתחיל את היום ביודעך מה השתנה ומה, אם בכלל, דורש אותך.",
    ],
    icon: "ph-sun",
    category: "visibility",
  },
  {
    id: "mobile-home-screen",
    title: ["Mobile & home screen", "מובייל ומסך הבית"],
    what: [
      "Add TELOS to your phone's home screen; it feels native and smooth.",
      "להוסיף את TELOS למסך הבית של הטלפון; חוויה טבעית וחלקה.",
    ],
    benefit: [
      "Your grow, one tap away — built for the phone in your pocket.",
      "הגידול שלך במרחק הקשה אחת — בנוי לטלפון שבכיס.",
    ],
    icon: "ph-device-mobile",
    category: "connectivity",
  },
];
