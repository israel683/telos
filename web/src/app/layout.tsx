import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Noto_Serif_Hebrew, Rubik } from "next/font/google";
import localFont from "next/font/local";
import { Nav } from "@/components/Nav";
import { LanguageProvider } from "@/lib/i18n";
import "./globals.css";
import "./telos-ui.css";

// TELOS typographic stack — see design-system/tokens.json (single source of
// truth).  ITC Souvenir is the canonical display + numbers face (warm humanist
// serif, reverence) self-hosted from src/app/fonts/.  Plus Jakarta Sans is the
// Latin body; Noto Serif Hebrew + Rubik are the Hebrew counterparts.
const souvenir = localFont({
  variable: "--font-souvenir",
  src: [
    { path: "./fonts/ITC Souvenir Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/ITC Souvenir Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ITC Souvenir Medium Italic.woff2", weight: "500", style: "italic" },
    { path: "./fonts/ITC Souvenir Demi.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ITC Souvenir Bold.woff2", weight: "700", style: "normal" },
  ],
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
      lang="en"
      dir="ltr"
      className={`dark ${souvenir.variable} ${jakarta.variable} ${notoSerifHebrew.variable} ${rubik.variable} h-full antialiased`}
    >
      {/* TELOS is a DARK system by default — the Warm Neutral palette IS
          the brand.  Foreground = parchment on a void background, with
          the body font selected by html[lang] in globals.css. */}
      <body className="min-h-full flex flex-col bg-[var(--ground-warm)] text-[var(--c-parchment)]">
        <LanguageProvider>
          <Nav />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
