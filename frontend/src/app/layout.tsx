import type { Metadata } from "next";
import { HeaderGate } from "@/components/HeaderGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse",
  description: "Market on your fingertips.",
};

// Applied before first paint, deliberately as a blocking inline script:
// the theme lives in localStorage, which React can only read after
// hydration — so doing this in an effect makes a stored preference flash
// the wrong theme for a frame on every load. No stored choice means no
// attribute, which lets the CSS fall through to prefers-color-scheme.
const NO_FLASH = `try{var t=localStorage.getItem('smw-theme');document.documentElement.setAttribute('data-theme',t||'light')}catch(e){}`;

import { DemoTutorial } from "@/components/DemoTutorial";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} /></head>
      <body>
        <HeaderGate />
        {children}
        <DemoTutorial />
      </body>
    </html>
  );
}
