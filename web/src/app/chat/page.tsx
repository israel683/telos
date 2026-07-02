"use client";

import { ChatPanel } from "@/components/ChatPanel";

/**
 * Standalone /chat route — the full-screen conversation.
 *
 * The chat now lives primarily in the app-wide Chat Island (a bottom sheet on
 * every screen — see components/ChatIsland.tsx). This route is the focused,
 * full-screen fallback: it's where new-system onboarding lands (SystemSwitcher
 * navigates here on create) and where a notification can deep-link. The island
 * hides itself on this route so the conversation is never doubled.
 */
export default function ChatPage() {
  return <ChatPanel variant="page" />;
}
