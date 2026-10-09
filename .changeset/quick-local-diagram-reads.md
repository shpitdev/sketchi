---
"@sketchi/cli": patch
---

List and show stored diagrams faster by avoiding PNG decompression during metadata reads. PNGs are still fully validated when written or consumed; command behavior is otherwise unchanged.
