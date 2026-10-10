---
"@sketchi/cli": patch
---

Generated diagrams no longer clip CJK, emoji, or long connector labels when opened in Excalidraw. Nodes are sized for wide glyphs, long edge labels wrap, long sequence participant names wrap inside their headers, and a label that would still overflow its node is reported instead of clipped. Latin-only layouts keep their exact previous widths. Text-style symbols such as © ™ ✔ ⚠ keep the default width; only emoji-presentation glyphs count as emoji.
