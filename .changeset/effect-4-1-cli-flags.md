---
"@sketchi/cli": patch
---

Update to Effect 4.1.1, which changes how the CLI parses and documents flags.

- **Repeated flags are rejected.** Giving a single-value flag more than once, such as `--output text --output json` or `--type flowchart --type gantt`, is now a usage error (exit 2, `Expected: at most 1 value`). Previously the first value was used and later ones were ignored. Pass each flag once.
- Usage errors keep their envelope: the first `--output` value still decides whether the error is text or the `{ ok: false, error: { code: "usage_error", message, hint } }` JSON envelope, and share links in any value stay redacted.
- Subcommand help lists `--output` under a separate INHERITED FLAGS section.
- `--completions` also generates PowerShell scripts (`powershell` or `pwsh`).
- In text mode, an invalid global flag value such as `--completions nushell` prints usage help before the error, like other usage errors.
