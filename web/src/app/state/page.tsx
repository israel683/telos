import { redirect } from "next/navigation";

/**
 * The dashboard moved to `/` (it is now the app's home page; chat moved to
 * `/chat`). This keeps old links/bookmarks to `/state` working.
 */
export default function StateRedirect() {
  redirect("/");
}
