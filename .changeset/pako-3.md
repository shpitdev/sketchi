---
"@sketchi/cli": patch
---

Bundle pako 3.0.3 for Excalidraw share links. The CLI selects pako's classic zlib hash, so `sketchi share` produces the same encrypted payload bytes as before and `sketchi pull` reads existing links unchanged. The bundled third-party notices list pako 3.0.3.
