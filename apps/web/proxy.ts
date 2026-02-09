import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const resolveRedirectUri = (): string => {
  if (process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}/callback`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/callback`;
  }
  if (process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI) {
    return process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  }
  return "http://localhost:3001/callback";
};

export default authkitMiddleware({
  // Vercel preview/prod need a dynamic redirect URI; dev falls back to env/default.
  redirectUri: resolveRedirectUri(),
});

// Run for all app routes and route handlers, but skip Next static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
