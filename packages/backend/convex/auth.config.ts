import type { AuthConfig } from "convex/server";

const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID must be set for WorkOS AuthKit auth");
}

const previewWorkOsClientId = "client_01KFPXKM905BYDQY5Q7BFJN409";
const legacyPreviewAuthConfigClientId = "client_01KG0NZ3QX0AJQE87CKZC74YXQ";
const productionWorkOsClientId = "client_01KG0NPZN3AWXNTRHC58VAPVW2";

export function buildWorkOsClientIds(primaryClientId: string): string[] {
  return Array.from(
    new Set(
      [
        primaryClientId,
        // Convex auth config can see the previously stored client during the
        // same deploy that refreshes WorkOS/Vercel credentials. Keep the
        // active handoff clients valid so first deploys do not reject fresh
        // AuthKit tokens.
        primaryClientId === legacyPreviewAuthConfigClientId
          ? previewWorkOsClientId
          : null,
        primaryClientId === legacyPreviewAuthConfigClientId ||
        primaryClientId === previewWorkOsClientId
          ? productionWorkOsClientId
          : null,
      ].filter((value): value is string => Boolean(value))
    )
  );
}

const clientIds = buildWorkOsClientIds(clientId);

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
