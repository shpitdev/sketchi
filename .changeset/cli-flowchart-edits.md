---
"@sketchi/cli": minor
---

`sketchi edit ID --json '{"edits":[...]}'` changes a stored flowchart by node id or label, offline: insert a step into an edge, set fields (including a node's `color`), connect or disconnect edges. `revise` on a flowchart now gets only the edits from the hosted model, so the answer is as long as the change; `--output json` shows them, with the output tokens and time the revision took. Flowchart node colors are part of the document, so a colored flowchart stays editable.
