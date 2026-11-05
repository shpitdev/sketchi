---
"@sketchi/cli": minor
---

`sketchi generate` copies the PNG it writes to the desktop clipboard and says so, so the image is ready to paste. It uses `wl-copy`, `xclip`, `osascript`, or PowerShell, skips CI, `--dest -`, non-PNG formats, and `--no-copy`, and a clipboard failure never changes the exit code. JSON output adds `clipboard: { copied, reason? }`. The text result is now just the title and type, the saved path, the copy status, and the id; the model and other details stay in `--output json` and `show`.

New `sketchi copy [id]` copies any stored diagram's PNG, defaulting to the newest.

Finding past diagrams: records now store when they were created and, for generated diagrams, the prompt. `sketchi list` shows the newest first with relative times, searches titles, ids, and prompts with `sketchi list <words>`, and takes `--type` and `--limit`. `list --output json` keeps its array shape but is now ordered newest first instead of by id, and adds `createdAt`, `updatedAt`, and `prompt`. Every id argument accepts `latest` or a unique prefix, and an unknown id suggests the closest ones. `sketchi show` prints a summary; `--document` adds the document, and `show --output json` is unchanged apart from the new fields.
