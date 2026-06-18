/**
 * The cultivar repository as imagery — the brand's cinematic spotlit-on-void
 * renders, one per crop. Powers the /cultivars gallery and the per-grow hero
 * (the grow's own crop, not a generic basil photo). Images live in
 * public/cultivars/<slug>.webp (+ -thumb.webp), optimized from the brand masters.
 */

export type CultivarShowcase = {
  slug: string;
  /** Proper cultivar name — kept in its original language, like a wine. */
  name: string;
  /** Crop type [en, he]. */
  crop: [string, string];
  /** Origin / appellation, or null. */
  provenance: string | null;
  /** Registry cultivar id, when this cultivar is fully coded in growk/cultivars. */
  cultivar_id: string | null;
};

/** The repository, in display order (coded cultivars first). */
export const CULTIVARS: CultivarShowcase[] = [
  { slug: "basilico-genovese", name: "Basilico Genovese", crop: ["Basil", "בזיליקום"], provenance: "Liguria, Italy", cultivar_id: "basilico-genovese-dop" },
  { slug: "cuore-di-bue", name: "Cuore di Bue", crop: ["Oxheart tomato", "עגבניית לב־שור"], provenance: "Liguria, Italy", cultivar_id: "cuore-di-bue" },
  { slug: "padron", name: "Pimientos de Padrón", crop: ["Pepper", "פלפל"], provenance: "Galicia, Spain", cultivar_id: "padron-peppers" },
  { slug: "radicchio-treviso", name: "Radicchio di Treviso", crop: ["Chicory", "עולש"], provenance: "Veneto, Italy", cultivar_id: "radicchio-rosso-di-treviso-igp" },
  { slug: "salanova", name: "Salanova", crop: ["Lettuce", "חסה"], provenance: null, cultivar_id: "lettuce" },
  { slug: "iceberg", name: "Iceberg", crop: ["Lettuce", "חסה"], provenance: null, cultivar_id: null },
  { slug: "lollo", name: "Lollo Rosso", crop: ["Lettuce", "חסה"], provenance: null, cultivar_id: null },
  { slug: "rucola", name: "Rucola", crop: ["Arugula", "ארוגולה"], provenance: "Italy", cultivar_id: null },
  { slug: "watercress", name: "Watercress", crop: ["Watercress", "גרגיר נחלים"], provenance: null, cultivar_id: null },
  { slug: "fragoline", name: "Fragoline di Bosco", crop: ["Wild strawberry", "תות־בר"], provenance: "Italy", cultivar_id: null },
  { slug: "nana", name: "Nana Mint", crop: ["Mint", "נענע"], provenance: "Middle East", cultivar_id: null },
];

export const cultivarThumb = (slug: string) => `/cultivars/${slug}-thumb.webp`;
export const cultivarFull = (slug: string) => `/cultivars/${slug}.webp`;

/**
 * Resolve the best cultivar image slug for a grow, by registry id first, then by
 * a species/crop-type keyword (en + he). Returns null when nothing matches, so
 * callers fall back to the founding-basil hero.
 */
export function cultivarSlug(cultivarId?: string | null, cropType?: string | null): string | null {
  if (cultivarId) {
    const exact = CULTIVARS.find((c) => c.cultivar_id === cultivarId);
    if (exact) return exact.slug;
  }
  const key = `${cultivarId ?? ""} ${cropType ?? ""}`.toLowerCase();
  if (/basil|בזיל/.test(key)) return "basilico-genovese";
  if (/tomato|עגבני/.test(key)) return "cuore-di-bue";
  if (/pepper|padron|פלפל/.test(key)) return "padron";
  if (/chicory|radicch|עולש|רדיקי/.test(key)) return "radicchio-treviso";
  if (/arugula|rucola|ארוגול|רוקט/.test(key)) return "rucola";
  if (/mint|nana|נענע/.test(key)) return "nana";
  if (/cress|נחלים/.test(key)) return "watercress";
  if (/strawberr|fragolin|תות/.test(key)) return "fragoline";
  if (/lettuce|salanova|lollo|iceberg|חסה/.test(key)) return "salanova";
  return null;
}

/** Full-size cultivar image path for a grow, or null (caller falls back). */
export function cultivarImage(cultivarId?: string | null, cropType?: string | null): string | null {
  const slug = cultivarSlug(cultivarId, cropType);
  return slug ? cultivarFull(slug) : null;
}
