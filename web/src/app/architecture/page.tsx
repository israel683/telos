/**
 * /architecture — admin-only architecture + live-state surface.
 *
 * The gate is now SERVER-SIDE (lib/admin-auth) — a real check against the
 * ADMIN_ACCESS_TOKEN secret via an httpOnly cookie — replacing the old build-time
 * public flag that only hid the link. Non-admins get the unlock form; admins get
 * the interactive explorer + the live system pulse.
 */
import { isAdmin, adminToken } from "@/lib/admin-auth";
import ArchitectureExplorer from "./ArchitectureExplorer";
import AdminUnlock from "./AdminUnlock";

// Always render dynamically — the gate depends on the per-request admin cookie.
export const dynamic = "force-dynamic";

export default async function ArchitecturePage() {
  if (!(await isAdmin())) {
    return <AdminUnlock configured={adminToken() !== null} />;
  }
  return <ArchitectureExplorer />;
}
