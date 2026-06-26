/**
 * POST /api/admin/unlock — exchange the admin secret for an httpOnly admin
 * cookie. Body: { token: string }. Server-side gate for the architecture surface.
 */
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, adminToken, tokenMatches } from "@/lib/admin-auth";

export async function POST(req: Request) {
  if (!adminToken()) {
    return NextResponse.json(
      { ok: false, error: "Admin access is not configured (ADMIN_ACCESS_TOKEN unset)." },
      { status: 503 }
    );
  }
  let provided = "";
  try {
    const body = (await req.json()) as { token?: string };
    provided = (body.token || "").trim();
  } catch {
    /* empty body */
  }
  if (!tokenMatches(provided)) {
    return NextResponse.json({ ok: false, error: "Invalid token." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, provided, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return res;
}
