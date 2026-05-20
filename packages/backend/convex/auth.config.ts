import type { AuthConfig } from "convex/server";

const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID must be set for WorkOS AuthKit auth");
}

const previewWorkOsClientId = "client_01KFPXKM905BYDQY5Q7BFJN409";
const legacyPreviewAuthConfigClientId = "client_01KG0NZ3QX0AJQE87CKZC74YXQ";

const clientIds = Array.from(
  new Set(
    [
      clientId,
      // Convex auth config only permits env vars already set in Convex.
      // During preview deploys, auth config currently sees the legacy client
      // while Vercel/WorkOS mint tokens for the newer preview client.
      clientId === legacyPreviewAuthConfigClientId
        ? previewWorkOsClientId
        : null,
    ].filter((value): value is string => Boolean(value))
  )
);

export default {
  providers: clientIds.flatMap((currentClientId) => {
    const currentJwks = `https://api.workos.com/sso/jwks/${currentClientId}`;
    return [
      {
        type: "customJwt" as const,
        issuer: "https://api.workos.com",
        algorithm: "RS256" as const,
        applicationID: currentClientId,
        jwks: currentJwks,
      },
      {
        type: "customJwt" as const,
        issuer: "https://api.workos.com/",
        algorithm: "RS256" as const,
        applicationID: currentClientId,
        jwks: currentJwks,
      },
      {
        type: "customJwt" as const,
        issuer: `https://api.workos.com/user_management/${currentClientId}`,
        algorithm: "RS256" as const,
        jwks: currentJwks,
      },
      {
        type: "customJwt" as const,
        issuer: `https://api.workos.com/user_management/${currentClientId}/`,
        algorithm: "RS256" as const,
        jwks: currentJwks,
      },
    ];
  }),
} satisfies AuthConfig;
