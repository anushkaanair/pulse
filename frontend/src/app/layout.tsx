import type { Metadata } from "next";
import { Header } from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Watchlist",
  description: "Meaningful market changes since you last looked.",
};

// Applied before first paint, deliberately as a blocking inline script:
// the theme lives in localStorage, which React can only read after
// hydration — so doing this in an effect makes a stored preference flash
// the wrong theme for a frame on every load. No stored choice means no
// attribute, which lets the CSS fall through to prefers-color-scheme.
const NO_FLASH = `try{var t=localStorage.getItem('smw-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} /></head>
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
