import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Newsreader } from "next/font/google";
import "./globals.css";
import { Masthead } from "@/components/Masthead";
import { KeepHistory } from "@/components/KeepHistory";
import { SyncRunner } from "@/components/SyncRunner";
import { PAPER, THEME_SCRIPT } from "@/lib/theme";

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  weight: "400",
  style: ["normal", "italic"],
});

const text = Newsreader({
  variable: "--font-text",
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: { default: "Mona", template: "%s · Mona" },
  description: "One work of art at a time, in the words of the people who knew it best.",
  appleWebApp: { capable: true, title: "Mona", statusBarStyle: "default" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PAPER.light },
    { media: "(prefers-color-scheme: dark)", color: PAPER.dark },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script sets data-theme before React starts, hence suppressHydrationWarning.
    <html lang="en" className={`${display.variable} ${text.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Masthead />
        <KeepHistory />
        <SyncRunner />
        {children}
      </body>
    </html>
  );
}
