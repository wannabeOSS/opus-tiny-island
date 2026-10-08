import type { Metadata, Viewport } from "next";
import { Shantell_Sans } from "next/font/google";
import "./globals.css";

const hand = Shantell_Sans({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Tiny Island",
  description: "A small living island. Poke it and see what happens.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f2dcc2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hand.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
