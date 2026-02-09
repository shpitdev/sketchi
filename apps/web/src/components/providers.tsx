"use client";

import { env } from "@sketchi/env/web";
import { useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useEffect } from "react";

import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

const useWorkosConvexAuth = () => {
  const { accessToken, loading, refresh } = useAccessToken();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        if (forceRefreshToken) {
          return (await refresh()) ?? null;
        }
        return accessToken ?? null;
      } catch {
        return null;
      }
    },
    [accessToken, refresh]
  );

  return {
    isLoading: loading,
    isAuthenticated: Boolean(accessToken),
    fetchAccessToken,
  };
};

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
    (
      window as Window & { __SKETCHI_CONVEX_URL?: string }
    ).__SKETCHI_CONVEX_URL = env.NEXT_PUBLIC_CONVEX_URL;
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
    >
      <ConvexProviderWithAuth client={convex} useAuth={useWorkosConvexAuth}>
        {children}
      </ConvexProviderWithAuth>
      <Toaster richColors />
    </ThemeProvider>
  );
}
