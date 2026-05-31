# TELOS Design System — single source of truth

`tokens.json` is the **one** place TELOS design tokens are defined. Edit it, run
the sync, and every consumer updates from the same values. No more hand-mirroring
between the CSS, the TS, and the docs (which had already drifted).

## The flow

```
                         design-system/tokens.json   ← edit only this
                                   │
                       npm run sync:design  (design-system/build.mjs)
        ┌──────────────────────────┼───────────────────────────┐
        ▼                          ▼                            ▼
 web/src/brand/             web/src/app/globals.css      design-system/
 tokens.generated.ts        (:root between the           tokens.css        ← portable CSS
 (typed; tokens.ts          DESIGN-TOKENS markers)       tokens.flat.json  ← name→value, for
  re-exports it)                                                             Figma / other apps
```

**To change a token:** edit `tokens.json` → `cd Code/web && npm run sync:design`
→ commit the regenerated files. That's it. Everything that reads tokens now
reflects the change.

> The generated files are **committed**, so the Vercel build (which has no need
> to re-run the generator) uses the checked-in output, and any consumer can read
> them straight from git.

## What each consumer reads

| Consumer | Reads | How it updates |
|---|---|---|
| Web app — CSS / Tailwind | `globals.css` `:root` (generated block) + `@theme` | regenerated on `sync:design` |
| Web app — TypeScript | `@/brand/tokens` → `tokens.generated.ts` | regenerated on `sync:design` |
| Another app / repo | `design-system/tokens.json` or `tokens.flat.json` | git submodule, or fetch the raw file, or publish as an npm package |
| Figma | `tokens.flat.json` | import via a tokens plugin (e.g. Tokens Studio); or wire Figma Variables ↔ this file as an upstream step |

## Rules

- **Never hand-edit** `tokens.generated.ts`, the `:root` block between the
  `DESIGN-TOKENS:START/END` markers in `globals.css`, `tokens.css`, or
  `tokens.flat.json`. They are overwritten on every sync.
- **Fonts in `globals.css` are hand-wired** (they reference the `next/font`
  runtime vars). `tokens.json` still holds the canonical font *families* — those
  flow to `tokens.generated.ts`, `tokens.css`, and `tokens.flat.json` for
  consumers that don't use `next/font`.
- Semantic aliases (`primary`, `success`, …) are references like `accent.basil`
  in `tokens.json`; the generator resolves them.

## Making it the source of truth for OTHER repos (when needed)

Leanest options, cheapest first:
1. **Fetch the raw file** — a consumer pulls `tokens.flat.json` from this repo at
   build time (one `curl`/`fetch` in their generate step). Zero packaging.
2. **Git submodule** — add `design-system/` as a submodule; consumers
   `git submodule update` to pick up changes.
3. **npm package** — publish `tokens.json` + `tokens.generated.ts` as
   `@telos/design-tokens`; consumers `npm update`. Most ergonomic at scale.

Start with (1); graduate to (3) only when there are several consumers.

## Upstream from Figma (optional)

If the design system should originate in Figma, the canonical direction is
Figma Variables → `tokens.json`: export Figma Variables to the flat token shape
and write them into `tokens.json`, then `sync:design` fans them out. This keeps
`tokens.json` as the in-repo source of truth while letting designers drive it
from Figma. (Not wired yet — say the word and point me at the Figma file.)
