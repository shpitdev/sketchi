import type { IntermediateDiagram } from "../intermediate";

export const architectureDiagramType = "architecture" as const;

export const architectureFixture = {
  edges: [
    { fromId: "web", id: "edge-web-api", label: "calls", toId: "api" },
    { fromId: "api", id: "edge-api-convex", label: "persists", toId: "convex" },
    { fromId: "api", id: "edge-api-ai", label: "generates", toId: "ai" },
  ],
  graphOptions: {
    diagramType: architectureDiagramType,
    layout: { direction: "LR", edgeRouting: "elbow" },
  },
  nodes: [
    { id: "web", kind: "app", label: "TanStack app" },
    { id: "api", kind: "worker", label: "Cloudflare Worker" },
    { id: "convex", kind: "database", label: "Convex" },
    { id: "ai", kind: "service", label: "AI provider" },
  ],
} satisfies IntermediateDiagram;
