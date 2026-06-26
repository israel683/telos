/**
 * Admin gate — a real, server-side check that replaces the build-time public
 * flag (`NEXT_PUBLIC_SHOW_ARCHITECTURE`) that "gated" the architecture surface.
 *
 * The architecture page exposes how TELOS is built (proprietary IP) and live
 * operational state, so it must be owner/admin-only — enforced on the SERVER,
 * not by a flag baked into the client bundle. A shared secret (`ADMIN_ACCESS_TOKEN`,
 * a NON-public env var) unlocks an httpOnly cookie; every admin route + the page
 * re-checks it here. Locked by default: no token configured ⇒ nobody is admin.
 */
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "telos_admin";
/** Cookie lifetime — admins re-unlock twice a day. */
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 12;

/** Constant-time string compare (avoids leaking the secret via timing). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** The configured admin secret, or null when admin access isn't set up. */
export function adminToken(): string | null {
  const t = process.env.ADMIN_ACCESS_TOKEN;
  // Require a non-trivial secret so a blank/short env can't accidentally unlock.
  return t && t.length >= 8 ? t : null;
}

/** True when the caller presented a cookie matching the configured admin secret. */
export async function isAdmin(): Promise<boolean> {
  const token = adminToken();
  if (!token) return false;
  const c = await cookies();
  const v = c.get(ADMIN_COOKIE)?.value;
  return !!v && safeEqual(v, token);
}

/** True when a provided unlock token matches the configured admin secret. */
export function tokenMatches(provided: string): boolean {
  const token = adminToken();
  return !!token && safeEqual(provided, token);
}
