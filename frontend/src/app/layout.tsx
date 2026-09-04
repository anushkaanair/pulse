import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Watchlist",
  description: "Meaningful market changes since you last looked.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
