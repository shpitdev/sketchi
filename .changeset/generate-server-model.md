---
"@sketchi/cli": minor
---

`sketchi generate` no longer has a `--model` flag and no longer names a model in its request: the server chooses the model, and the result still reports which one ran. Scripts that pass `--model` must drop it.
