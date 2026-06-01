/* GENERATED from design-system/tokens.json — do not edit by hand.
   Regenerate: npm run sync:design (TS). */

export const FOUNDATION = {
  "void": "#0c0c0a",
  "soil": "#181815",
  "earth": "#232320",
  "bark": "#333330",
  "stone": "#606058",
  "ash": "#9a9a92",
  "fog": "#c6c5be",
  "parchment": "#eeede8"
} as const;

export const ACCENT = {
  "basil": "#89a83e",
  "moss": "#3e5230",
  "terra": "#a8593a",
  "mineral": "#3a4d4a"
} as const;

export const SEMANTIC = {
  "primary": "#89a83e",
  "success": "#89a83e",
  "warning": "#a8593a",
  "data": "#3a4d4a",
  "surface": "#181815",
  "surface2": "#232320",
  "bg": "#0c0c0a",
  "text": "#eeede8",
  "textMuted": "#9a9a92",
  "textDim": "#606058"
} as const;

export const TYPE = {
  "display_en": "'Souvenir', Georgia, 'Times New Roman', serif",
  "body_en": "'Plus Jakarta Sans', system-ui, sans-serif",
  "display_he": "'Noto Serif Hebrew', 'Souvenir', serif",
  "body_he": "'Rubik', 'Plus Jakarta Sans', system-ui, sans-serif",
  "numbers": "'Souvenir', Georgia, serif",
  "sizes": {
    "xs": "0.58rem",
    "sm": "0.75rem",
    "base": "0.95rem",
    "md": "1.25rem",
    "lg": "1.8rem",
    "xl": "2.5rem",
    "2xl": "4rem"
  },
  "tracking": {
    "tight": "0.02em",
    "normal": "0.05em",
    "wide": "0.15em",
    "label": "0.28em",
    "logo": "0.22em"
  }
} as const;

export const SPACE = {
  "1": 4,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64
} as const;

export const RADIUS = {
  "none": "0px",
  "sm": "3px",
  "btn": "6px",
  "md": "8px",
  "card": "8px",
  "lg": "14px",
  "soft": "14px",
  "pill": "999px"
} as const;

export const BORDER = {
  "subtle": "1px solid rgba(238,237,232,0.07)",
  "dim": "1px solid rgba(238,237,232,0.12)",
  "basil": "1px solid rgba(137,168,62,0.25)",
  "hair": "1px solid var(--c-bark)"
} as const;

export const MOTION = {
  "easing": {
    "out": "cubic-bezier(0.22, 1, 0.36, 1)",
    "in": "cubic-bezier(0.64, 0, 0.78, 0)"
  },
  "duration": {
    "fast": 150,
    "base": 280,
    "slow": 600,
    "scene": 1400
  }
} as const;

export const TAGLINES = {
  "primary": "Every plant, its fullest self.",
  "secondary": "Not optimized. Fulfilled."
} as const;

export const LIGHT = {
  "amber": "#a8783c",
  "amber-glow": "rgba(214,182,120,.22)",
  "ground-warm": "color-mix(in srgb, var(--c-void) 98%, var(--amber) 2%)",
  "surface-warm": "color-mix(in srgb, var(--c-soil) 97%, var(--amber) 3%)",
  "surface-light": "#f1ece1",
  "cool": "#16201f",
  "glow-shadow": "0 18px 44px rgba(0,0,0,.55)",
  "glow-tint": "var(--amber)",
  "lit-white": "#f6efdc",
  "spotlight": "168deg",
  "beam-blur": "13px",
  "beam-angle": "16deg",
  "radius-soft": "14px"
} as const;

export const ROLE = {
  "bg": "var(--ground-warm)",
  "surface": "var(--surface-warm)",
  "surface-2": "var(--c-earth)",
  "text": "var(--c-parchment)",
  "text-soft": "var(--c-fog)",
  "text-muted": "var(--c-stone)",
  "line": "var(--c-bark)",
  "accent": "var(--c-basil)"
} as const;

export const ATMOSPHERE = {
  "breathe": "5s",
  "breathe-glow": "9.5s",
  "breathe-min": "0.72",
  "drift": "23s",
  "reveal": "1.4s",
  "grain-opacity": "0.04",
  "grain-z": "500"
} as const;
