import type { AuthConfig } from "convex/server";

const clientId = process.env.WORKOS_CLIENT_ID;

if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID must be set for WorkOS AuthKit auth");
}

const jwks = `https://api.workos.com/sso/jwks/${clientId}`;

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com",
      algorithm: "RS256",
      applicationID: clientId,
      jwks,
    },
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      applicationID: clientId,
      jwks,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}/`,
      algorithm: "RS256",
      jwks,
    },
  ],
} satisfies AuthConfig;
