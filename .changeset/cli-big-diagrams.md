---
"@sketchi/cli": minor
---

`sketchi generate` handles large diagrams. It waits up to 150 seconds for the generate API, up from 90, so a big diagram that takes two model calls still arrives. A request that needs more than Sketchi can draw, or more than one model answer can hold, fails with the server's message naming that limit and exits 3, instead of a generic provider error. `--output json` reports the generation's model calls, duration and output tokens under `generation`.

PNG export renders drawings up to 16,000 units a side (a 60-step flowchart is about 9,000 tall), scaling down to stay within 25,165,824 pixels and 16,384 pixels a side, the same raster budget as before.
