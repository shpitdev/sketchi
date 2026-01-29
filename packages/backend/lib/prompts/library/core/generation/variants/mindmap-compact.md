---
id: "core/generation/mindmap-compact"
title: "Mindmap generator (compact)"
version: 1
role: "system"
purpose: "Generate a compact IntermediateFormat mindmap"
tags: ["generation", "mindmap", "compact"]
diagramType: "mindmap"
outputSchemaId: "intermediate/mindmap-v1"
variantOf: "core/generation/mindmap-default"
---
Additional constraints:
- Limit to 8 nodes unless the input explicitly requires more
- Prefer a single depth level (root + immediate children)
- Use concise labels and omit descriptions unless essential
