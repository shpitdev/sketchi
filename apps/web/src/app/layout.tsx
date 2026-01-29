import { Analytics } from "@vercel/analytics/react";
import type { Metadata } from "next";

import { Caveat, Geist, Geist_Mono } from "next/font/google";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const siteUrl = "https://sketchi.app";
const ogImage = "/og-image.png";
const description =
  "Sketchi is a diagram and icon library toolkit that transforms SVGs into hand-drawn Excalidraw assets. Build icon libraries, generate AI-powered diagrams, and export production-ready .excalidrawlib files.";

export const metadata: Metadata = {
  title: "Sketchi",
  description,
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Sketchi",
    description,
    url: siteUrl,
    siteName: "Sketchi",
    type: "website",
    images: [
      {
        url: ogImage,
        width: 1280,
        height: 800,
        alt: "Sketchi Home",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sketchi",
    description,
    images: [ogImage],
  },
};

const safeSerialize = (value: string) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  const convexScript = {
    __html: `window.__SKETCHI_CONVEX_URL=${safeSerialize(convexUrl)};`,
  };
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} antialiased`}
      >
        {convexUrl ? (
          <script
            // biome-ignore lint/security/noDangerouslySetInnerHtml: required to pass env config to client
            dangerouslySetInnerHTML={convexScript}
          />
        ) : null}
        <Providers>
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Header />
            {children}
          </div>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
