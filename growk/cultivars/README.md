# Cultivar Registry

The single, version-controlled source of truth for what the Brain **knows** about a
plant. This is the Network Knowledge layer from `../../NEXTGEN-ARCHITECTURE.md` §1.

The brand sells **cultivar** (Basilico Genovese DOP), not **crop** (basil). These
files encode cultivar-level protocols; crop-level files live under `species/` and act
as the inheritance base and fallback.

## Why files

Static knowledge = code: authored here, reviewed through Git, history preserved. (The
next iteration seeds these into the database so the TypeScript dashboard reads the same
records — the DB becomes the cross-service runtime source. Until then the Python Brain
loads them directly.)

## Layout

```
cultivars/
  species/<species>.json      # crop-level base (inherits: null) — fallback + inheritance root
  <cultivar-id>.json          # cultivar-level protocol (inherits a species)
```

## Schema

```jsonc
{
  "id": "basilico-genovese-dop",     // stable kebab-case id; also the systems.crop_type value
  "species": "basil",                 // species family
  "cultivar": "Basilico Genovese DOP",// display name (null for a species file)
  "provenance": "Liguria, Italy",     // where it comes from — part of the premium story
  "protocol_version": 1,              // bump on any band change; the data-flywheel version
  "inherits": "basil",                // species id to inherit stages from (null for species files)

  // Target bands per growth stage. Same shape as the TS MetricTarget in
  // web/src/lib/tolerance.ts so both runtimes agree. A cultivar overrides the
  // inherited species stage per-metric; anything omitted falls through to the parent.
  "stages": {
    "seedling":   { "ph": { "target": 6.0, "tolerance": 0.4, "tolerance_mode": "absolute" },
                    "ec": { "target": 1000, "tolerance": 20, "tolerance_mode": "percent" },
                    "water_temp": { "target": 22, "tolerance": 4, "tolerance_mode": "absolute" } },
    "vegetative": { "...": "..." },
    "flowering":  { "...": "..." },
    "fruiting":   { "...": "..." }
  },

  "stress_signatures": [              // how this cultivar shows distress — helps the Brain read the plant
    "Tip burn at EC above band — Genovese is sensitive to salt accumulation."
  ],
  "harvest_markers": [                // plant-led readiness signals (brand voice: the plant says ready)
    "Pinch above the 6th leaf node once 4 true-leaf pairs are set."
  ],
  "story": {                          // the chef-facing provenance line, bilingual
    "he": "...",
    "en": "..."
  }
}
```

`tolerance_mode`: `absolute` (pH, water_temp) or `percent` (EC, where 20% of 1000 = ±200).
Effective band = `target ± (tolerance_mode === "percent" ? target*tolerance/100 : tolerance)`.

## Resolution order (mirrors the precedence law)

The Brain resolves a value as: safety hard-limits → grower-confirmed facts → grow
context → **cultivar protocol (this file)** → species defaults → generic fallback.
