"use client";

import { env } from "@sketchi/env/web";
import {
  useAccessToken as useWorkosAccessToken,
  useAuth as useWorkosAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";

const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

function useConvexAuthFromWorkOS() {
  const { user, loading: authLoading } = useWorkosAuth();
  const {
    accessToken,
    error: tokenHookError,
    refresh,
    getAccessToken,
  } = useWorkosAccessToken();
  const [tokenCache, setTokenCache] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setTokenCache(null);
      setTokenError(null);
      return;
    }
    if (accessToken) {
      setTokenCache(accessToken);
      setTokenError(null);
    }
  }, [accessToken, user]);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      if (!user) {
        setTokenError(null);
        return null;
      }

      if (!forceRefreshToken && tokenCache) {
        setTokenError(null);
        return tokenCache;
      }

      try {
        const directToken = await getAccessToken();
        const refreshedToken =
          directToken || !forceRefreshToken ? null : await refresh();
        const fallbackRefreshedToken =
          directToken || refreshedToken ? null : await refresh();
        const token =
          directToken ??
          refreshedToken ??
          fallbackRefreshedToken ??
          accessToken ??
          tokenCache ??
          null;
        if (!token) {
          setTokenError(null);
          return null;
        }
        setTokenCache(token);
        setTokenError(null);
        return token;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch WorkOS access token";
        setTokenError((prev) => prev ?? message);
        console.error("[auth] WorkOS access token fetch failed", error);
        return null;
      }
    },
    [accessToken, getAccessToken, refresh, tokenCache, user]
  );

  const resolvedAccessToken = accessToken ?? tokenCache ?? null;

  return useMemo(
    () => ({
      tokenError: tokenError ?? tokenHookError?.message ?? null,
      isLoading:
        authLoading ||
        (Boolean(user) &&
          !resolvedAccessToken &&
          tokenError === null &&
          tokenHookError === null),
      isAuthenticated:
        Boolean(user) &&
        Boolean(resolvedAccessToken) &&
        tokenError === null &&
        tokenHookError === null,
      fetchAccessToken,
    }),
    [
      authLoading,
      fetchAccessToken,
      resolvedAccessToken,
      tokenError,
      tokenHookError,
      user,
    ]
  );
}

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
      <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromWorkOS}>
        {children}
      </ConvexProviderWithAuth>
      <Toaster richColors />
    </ThemeProvider>
  );
}
