# Authorization

WorkOS/AuthKit answers who the user is. Convex `users` rows answer what that
user can do.

## Model

- `users.role = "admin"` grants full admin access.
- `users.canManagePublicIconLibraries = true` grants public icon-library
  management without full admin access.
- Admins also manage public icon libraries.
- Normal authenticated users keep private diagram and private icon-library
  behavior.

The legacy env/source allowlists are not active authorization inputs:

- `SKETCHI_ADMIN_EMAILS`
- `SKETCHI_ADMIN_SUBJECTS`
- `SKETCHI_ICON_LIBRARY_EDITOR_EMAILS`
- `SKETCHI_ICON_LIBRARY_EDITOR_SUBJECTS`

## Bootstrap

Use `SKETCHI_BOOTSTRAP_ADMIN_EMAILS` or `SKETCHI_BOOTSTRAP_ADMIN_SUBJECTS` only
to create the first app-owned admin. The bootstrap match is ignored after any
Convex `users` row has `role = "admin"`.

After first-admin bootstrap, manage privileges with the guarded Convex mutation:

```ts
api.users.updateAuthorization({
  userId,
  role: "user" | "admin",
  canManagePublicIconLibraries: boolean,
});
```

Only an existing Convex admin can call it.

## Secret Hygiene Follow-Up

This pass may mark existing Vercel environment variables as sensitive where the
platform supports it, but it intentionally does not rotate keys. Rotate these
after this authz change lands:

- `WORKOS_API_KEY`
- `WORKOS_COOKIE_PASSWORD`
- `OPENROUTER_API_KEY`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_DSN`
- `SENTRY_OTLP_TRACES_URL`
- `SENTRY_VERCEL_LOG_DRAIN_URL`
- `CONVEX_DEPLOY_KEY` or equivalent Convex deploy credentials, if present

Remove old authorization allowlist env values from Vercel and Convex after the
first Convex admin is confirmed.

Preview WorkOS credentials must stay aligned across the web runtime and the
Convex auth provider config. If a preview deployment uses a lower-env WorkOS
client for sign-in, deploy Convex with the same `WORKOS_CLIENT_ID`; otherwise
Convex will reject the issued access token before app authorization runs.
