import type { IntermediateDiagram } from "../intermediate";

export const flowchartDiagramType = "flowchart" as const;

export const flowchartFixture = {
  edges: [
    {
      fromId: "signup",
      id: "edge-signup-profile",
      label: "creates",
      toId: "profile",
    },
    {
      fromId: "profile",
      id: "edge-profile-invite",
      label: "invites",
      toId: "team",
    },
    { fromId: "team", id: "edge-team-done", label: "finishes", toId: "done" },
  ],
  graphOptions: {
    diagramType: flowchartDiagramType,
    layout: { direction: "LR" },
  },
  nodes: [
    { id: "signup", kind: "start", label: "Sign up" },
    { id: "profile", kind: "process", label: "Complete profile" },
    { id: "team", kind: "process", label: "Invite team" },
    { id: "done", kind: "end", label: "Ready" },
  ],
} satisfies IntermediateDiagram;
