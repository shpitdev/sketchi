# Goal

Make the Sketchi v2 app surfaces feel like real products, not scaffolds. The
deployment foundation is ready: PR previews and production `workers.dev` URLs
work, while final `sketchi.app` domain attachment is prohibited until this fork
has been fully merged into the original `shpitdev/sketchi` repository. Own the
next
phase end to end: inspect the current app shells, improve the product UX,
preserve clean Nx boundaries, and prove the result on the real surfaces.

Prioritize the public web surface first because it is what must eventually beat
the current production site before DNS changes. Then harden the two standalone
apps that will become `excalidraw.sketchi.app` and `icons.sketchi.app`.

# Scope

- Build out `apps/web` into a useful home and docs surface for Sketchi v2. It
  should explain the product, architecture, playground, Excalidraw workspace,
  icon output, and current no-auth status without feeling like a placeholder or
  marketing shell. The first viewport should make Sketchi obvious and credible,
  and the docs path should be navigable and useful.
- Build out `apps/excalidraw` as the real no-auth app shell for diagram work.
  It should feel like the beginning of the product app: useful workspace
  structure, sample diagram state, inspectable generation/IR context, clear
  empty/loading/error affordances where relevant, and a path that can later
  accept auth and persistence without a rewrite.
- Build out `apps/icons` as the standalone home for the copied pre-cleaned
  `sketchi-icons` output. It should be fast to browse, search, filter, inspect,
  and copy/download useful icon assets. Do not add the upstream icon-cleaning
  pipeline here yet; consume the app-local copied output only.
- Keep app-owned UI inside the app that uses it unless a component is truly
  shared. Generate new UI components with the Nx Sketchi generator so
  PascalCase components, tests, exports, and Storybook stories stay consistent.
  Prefer app-local generated components over shared dependencies when sharing
  would make the affected graph less useful.
- Use `packages/diagram-studio-ui` only for genuinely reusable diagram/studio
  primitives. Avoid turning it into a dumping ground for one-off web, icons, or
  shell layout pieces.
- Auth is intentionally out of scope. Design states so auth can be added later,
  but do not introduce auth flows, protected routes, fake login controls, or
  auth dependencies in this pass.
- DNS cutover is intentionally out of scope. Use PR preview Workers and stable
  `workers.dev` production URLs for proof. Do not attach or repoint
  `sketchi.app` domains, and do not recommend domain cutover as a next step.
  Reconsider it only after the completed v2 fork has been merged back into the
  original `shpitdev/sketchi` repository.

# UX Direction

Treat this as product design work with implementation responsibility. Use the
repo and live surfaces as truth, but be willing to improve copy, layout,
information architecture, and interaction flow when the current shells feel too
thin.

Claude models other than Fable can be useful here once the work is truly product
UI/UX rather than setup, standards, generators, or deployment wiring. Fable is
strictly advisory and may only return analysis; it must never implement or edit
the repository. If another Claude model is used, let it rip on the UI/UX
implementation and iteration for the app surfaces: visual hierarchy, layout,
copy, interaction flow, states, screenshots, and Storybook or browser-preview
feedback. Treat its output as editable product work that can be kept, revised,
or backed out. Keep repo truth, structural boundaries, generator
creation/changes, deployment configuration, tests, and final proof owned by the
goal runner.

# Boundaries

- Do not repoint DNS or run the manual `attach_domains` production workflow.
- Do not add auth, persistence, billing, or multi-user collaboration.
- Do not move the icon-cleaning/copying pipeline into `apps/icons` unless the
  repo already has a clean app-local contract for it. Display copied outputs
  only.
- Do not create a landing page that hides the actual usable app surfaces. The
  first screen for each app should be the real experience or a useful product
  entry point.
- Do not add broad shared abstractions unless they clearly reduce real
  duplication and match existing local patterns.
- Do not leave important work only in `.memory/`; use `.memory/` only for local
  screenshots, notes, and proof artifacts.

# Proof

- Run the relevant Nx checks for changed projects. At minimum, include
  typecheck, tests, and builds for affected apps/packages. For generated
  components and UI changes, build the relevant Storybook targets and add or
  adjust stories/tests.
- Use browser proof for every changed app surface. Verify desktop and mobile
  widths, interaction states, no text overlap, no broken assets, and that the
  page feels like the intended product rather than a placeholder.
- Use Cloudflare PR preview Workers for remote proof and smoke the preview URLs
  with HTTP plus browser checks. After merge, verify the stable production
  `workers.dev` URLs. Do not require final custom domains.
- For `apps/icons`, verify real copied output renders and that search/filter
  behavior works on dense and sparse result sets.
- For `apps/excalidraw`, verify the workspace renders a real diagram scene and
  that any inspectable state matches the underlying diagram data.
- Fix in-scope failures found during verification instead of stopping at the
  first passing command. Finish with a PR that reports what changed, what proof
  passed, the preview URLs, and what remains intentionally deferred.
