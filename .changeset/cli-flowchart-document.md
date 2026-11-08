---
"@sketchi/cli": patch
---

`generate` and `revise` read flowcharts in the hosted service's new flowchart document, where each step names its swimlane or group. Earlier versions reject those flowcharts with `invalid_generated_document`, so update to keep swimlane and grouped flowcharts working.
