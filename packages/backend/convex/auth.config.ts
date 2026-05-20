import type { AuthConfig } from "convex/server";

const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID must be set for WorkOS AuthKit auth");
}

const previewWorkOsEnvironmentId = "environment_01KFPXKKS4QA3NP3VT0Q52WXB1";
const previewWorkOsClientId = "client_01KFPXKM905BYDQY5Q7BFJN409";

const clientIds = Array.from(
  new Set(
    [
      clientId,
      process.env.WORKOS_ENVIRONMENT_ID === previewWorkOsEnvironmentId ||
      process.env.VERCEL_ENV === "preview"
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
