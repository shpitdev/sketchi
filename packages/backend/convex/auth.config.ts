import type { AuthConfig } from "convex/server";

const workosClientId = process.env.WORKOS_CLIENT_ID;
if (!workosClientId) {
  throw new Error(
    "WORKOS_CLIENT_ID is required for WorkOS AuthKit JWT verification. Set it in the Convex deployment environment (or run `convex dev --configure` locally)."
  );
}

// WorkOS AuthKit issues tokens for both the "SSO" issuer and the "User Management" issuer.
// We allow both so the same Convex deployment can accept JWTs from either auth method.
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: workosClientId,
      issuer: "https://api.workos.com/",
      jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
      algorithm: "RS256",
    },
    {
      type: "customJwt",
      applicationID: workosClientId,
      issuer: `https://api.workos.com/user_management/${workosClientId}`,
      jwks: `https://api.workos.com/user_management/jwks/${workosClientId}`,
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
