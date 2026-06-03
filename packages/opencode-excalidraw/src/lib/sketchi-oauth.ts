import { fetchJson } from "@sketchi/diagram-exporter";

const SKETCHI_PROVIDER_ID = "sketchi";
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface OAuthAuthDetails {
  access: string;
  expires: number;
  refresh: string;
  type: "oauth";
}

export interface OAuthAuthLike {
  access?: string;
  expires?: number;
  refresh?: string;
  type: "oauth";
}

export interface NonOAuthAuthDetails {
  type?: string;
  [key: string]: unknown;
}

export type AuthDetails = OAuthAuthLike | NonOAuthAuthDetails;

export interface SketchiPluginClient {
  auth: {
    set(input: {
      path: { id: string };
      body: OAuthAuthDetails;
    }): Promise<unknown>;
  };
}

interface RefreshTokenResponse {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  status: "success" | "invalid_grant";
}

export function isOAuthAuth(
  auth: AuthDetails | null | undefined
): auth is OAuthAuthLike {
  return auth?.type === "oauth";
}

export function accessTokenExpired(auth: OAuthAuthLike): boolean {
  if (!auth.access || typeof auth.expires !== "number") {
    return true;
  }

  return auth.expires <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS;
}

async function persistOAuthAuth(
  client: SketchiPluginClient,
  auth: OAuthAuthDetails
): Promise<void> {
  await client.auth.set({
    path: { id: SKETCHI_PROVIDER_ID },
    body: auth,
  });
}

export async function clearPersistedOAuthAuth(
  client: SketchiPluginClient
): Promise<void> {
  await persistOAuthAuth(client, {
    type: "oauth",
    access: "",
    refresh: "",
    expires: 0,
  });
}

export async function refreshSketchiAccessToken(input: {
  abort?: AbortSignal;
  apiBase: string;
  auth: OAuthAuthLike;
  client: SketchiPluginClient;
  traceId: string;
}): Promise<OAuthAuthDetails | undefined> {
  const refreshToken = input.auth.refresh?.trim();
  if (!refreshToken) {
    return undefined;
  }

  try {
    const result = await fetchJson<RefreshTokenResponse>(
      `${input.apiBase}/api/auth/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-trace-id": input.traceId,
        },
        body: JSON.stringify({
          refreshToken,
          traceId: input.traceId,
        }),
      },
      input.abort
    );

    if (
      result.status !== "success" ||
      !result.accessToken ||
      !result.refreshToken
    ) {
      await clearPersistedOAuthAuth(input.client).catch(() => undefined);
      return undefined;
    }

    const updatedAuth: OAuthAuthDetails = {
      type: "oauth",
      access: result.accessToken,
      refresh: result.refreshToken,
      expires: result.accessTokenExpiresAt ?? Date.now() + DEFAULT_TOKEN_TTL_MS,
    };

    await persistOAuthAuth(input.client, updatedAuth).catch(() => undefined);
    return updatedAuth;
  } catch {
    return undefined;
  }
}
