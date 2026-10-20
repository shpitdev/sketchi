---
"@sketchi/cli": patch
---

A swimlane diagram that reads longer than 2.3:1 along its flow now tightens. A handoff to a lane two or more away runs straight across when the lanes in between are empty in that column. Gaps between columns that lines only cross straight shrink from 90 to 56 units, and gaps that lines turn in shrink to the stubs either side of each turn. Each change is kept only when it routes no worse and no line gets longer, hooks or detours. The left-to-right incident-response swimlane goes from 2.6:1 to 2.35:1.
