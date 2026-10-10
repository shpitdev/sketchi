---
"@sketchi/cli": minor
---

Node logos now appear in exported drawings and PNGs. `sketchi export --format png` rasterizes the logo images embedded in a diagram, and `sketchi pull` keeps a shared drawing's image files instead of dropping them. PNG export also handles drawings whose image ids contain characters like `:`, and its embedded-image size limit counts only images still in the drawing.
