import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Plus_Jakarta_Sans, Noto_Serif_Hebrew, Rubik } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

// TELOS typographic stack — see src/brand/tokens.ts.  Cormorant Italic
// 300 is the display + numbers face; Plus Jakarta Sans 300 is body for
// Latin; Noto Serif Hebrew + Rubik are the Hebrew counterparts.  Souvenir
// (the canonical display per the brief) is a commercial face — Cormorant
// is the open-source substitute the brief itself uses in HTML samples.
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  weight: ["300", "400"],
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  weight: ["300", "400", "500"],
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const notoSerifHebrew = Noto_Serif_Hebrew({
  variable: "--font-noto-serif-hebrew",
  weight: ["300", "400"],
  subsets: ["hebrew"],
  display: "swap",
});

const rubik = Rubik({
  variable: "--font-rubik",
  weight: ["300", "400", "500"],
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Telos — לוח בקרה",
  description: "מערכת הידרופונית חכמה",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Telos",
    statusBarStyle: "black-translucent",
  },
};

// `themeColor` + `viewport` belong on the Viewport export in Next 15+
// (the Metadata export type no longer accepts themeColor).
export const viewport: Viewport = {
  themeColor: "#10b981",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // notch / safe-area awareness
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`dark ${cormorant.variable} ${jakarta.variable} ${notoSerifHebrew.variable} ${rubik.variable} h-full antialiased`}
    >
      {/* TELOS is a DARK system by default — the Warm Neutral palette IS
          the brand.  Foreground = parchment on a void background, with
          the body font selected by html[lang] in globals.css. */}
      <body className="min-h-full flex flex-col bg-[var(--c-void)] text-[var(--c-parchment)]">
        <Nav />
        {children}
      </body>
    </html>
  );
}
