---
"@sketchi/cli": patch
---

A generate request that doesn't name its diagram kind is now drawn as the one kind Sketchi decides for it, instead of leaving the drawing model to choose between two or three close kinds. A plan of dated phases or workstreams draws as a Gantt chart; a history or a roadmap of events draws as a timeline. A process with checks or decisions that branch it draws as a flowchart, even when it names the systems that carry it out; messages that named participants exchange in order draw as a sequence diagram.
