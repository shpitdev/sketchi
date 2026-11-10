---
"@sketchi/cli": patch
---

A generate request that doesn't name its diagram kind is now drawn as the one kind Sketchi decides for it. Before, when two or three kinds were close, the drawing model chose among them, and in a third of those requests it drew a different kind than the one the request most likely meant. Now a question that tells the two closest kinds apart decides, at no added latency. A plan of dated phases or workstreams draws as a Gantt chart; a history or a roadmap of events draws as a timeline.
