const DEFAULT_PROD_URL = "https://sketchi.app";
const DEFAULT_DEV_URL = "http://localhost:3001";

const resolvedEnv = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "dev";

export const envLabel = (() => {
  if (resolvedEnv === "production") {
    return "prod";
  }
  if (resolvedEnv === "development") {
    return "dev";
  }
  return resolvedEnv;
})();

export const appUrl = (() => {
  const explicit = process.env.SKETCHI_APP_URL ?? process.env.APP_URL;
  if (explicit) {
    return explicit;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return envLabel === "prod" ? DEFAULT_PROD_URL : DEFAULT_DEV_URL;
})();
