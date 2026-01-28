"use client";

import { env } from "@sketchi/env/web";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useEffect } from "react";

import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    (window as Window & { __SKETCHI_CONVEX_URL?: string }).__SKETCHI_CONVEX_URL =
      env.NEXT_PUBLIC_CONVEX_URL;
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <ConvexProvider client={convex}>{children}</ConvexProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
