import { Effect } from "effect";

import type { BuiltDiagram } from "../contracts.js";
import {
  decodeCanonicalDiagramDocument,
  type CanonicalDiagramDocument,
} from "../document.js";

export const flowchartInput = {
  type: "flowchart",
  spec: {
    id: "release-flow",
    title: "Release approval",
    nodes: [
      { id: "start", label: "Change proposed", kind: "start" },
      { id: "review", label: "Review evidence", kind: "process" },
      { id: "end", label: "Release approved", kind: "end" },
    ],
    edges: [
      { source: "start", target: "review" },
      { source: "review", target: "end" },
    ],
  },
} as const;

export const mindmapInput = {
  type: "mindmap",
  spec: {
    id: "launch-map",
    title: "Launch plan",
    root: {
      label: "Launch",
      children: [{ label: "Product" }, { label: "Operations" }],
    },
  },
} as const;

/** Compact canonical fixtures derived from the 2026-09-04 production probes. */
export const largeFlowchartInput = {
  type: "flowchart",
  spec: {
    id: "cicd-pipeline-graph",
    title:
      "Create a 20-node CI/CD dependency graph with fan-out into lint, unit, integration, and security, fan-in before staging, a canary decision, a rollback loop, and production monitoring.",
    nodes: [
      ["start", "Code Commit", "start"],
      ["build", "Build Artifact", "process"],
      ["lint", "Lint", "process"],
      ["unit", "Unit Test", "process"],
      ["integ", "Integration Test", "process"],
      ["sec", "Security Scan", "process"],
      ["merge", "Merge Results", "process"],
      ["stage-deploy", "Deploy to Staging", "process"],
      ["stage-test", "Staging Validation", "process"],
      ["canary-dec", "Canary Check?", "decision"],
      ["canary-deploy", "Deploy Canary", "process"],
      ["canary-eval", "Canary Success?", "decision"],
      ["prod-deploy", "Deploy to Prod", "process"],
      ["monitor", "Monitor Health", "process"],
      ["health-check", "Healthy?", "decision"],
      ["rollback", "Rollback", "process"],
      ["notify", "Notify Team", "process"],
      ["archive", "Archive Build", "process"],
      ["end-success", "Success", "end"],
      ["end-fail", "Failure", "end"],
    ].map(([id, label, kind]) => ({ id, label, kind })),
    edges: [
      ["start", "build"],
      ["build", "lint"],
      ["build", "unit"],
      ["build", "integ"],
      ["build", "sec"],
      ["lint", "merge"],
      ["unit", "merge"],
      ["integ", "merge"],
      ["sec", "merge"],
      ["merge", "stage-deploy"],
      ["stage-deploy", "stage-test"],
      ["stage-test", "canary-dec"],
      ["canary-dec", "canary-deploy", "yes"],
      ["canary-dec", "prod-deploy", "no"],
      ["canary-deploy", "canary-eval"],
      ["canary-eval", "prod-deploy", "yes"],
      ["canary-eval", "rollback", "no"],
      ["prod-deploy", "monitor"],
      ["monitor", "health-check"],
      ["health-check", "end-success", "yes"],
      ["health-check", "rollback", "no"],
      ["rollback", "notify"],
      ["notify", "archive"],
      ["archive", "end-fail"],
      ["rollback", "build", "retry"],
    ].map(([source, target, label], index) => ({
      id: `e${String(index + 1)}`,
      source,
      target,
      ...(label ? { label } : {}),
    })),
    layout: { direction: "TB" },
  },
};

const architectureTopics = {
  Fundamentals: ["Principles", "Styles", "Documentation"],
  "Design Patterns": ["Creational", "Structural", "Behavioral"],
  "Distributed Systems": ["Communication", "Consistency", "Scalability"],
  "Data Architecture": ["Storage Models", "Data Pipelines", "Caching"],
  Reliability: ["Fault Tolerance", "Observability", "Disaster Recovery"],
  Security: ["Identity", "Encryption", "Compliance"],
  "Practical Activities": ["System Design", "Code Reviews", "Tech Spikes"],
};

export const largeMindmapInput = {
  type: "mindmap",
  spec: {
    id: "software-architecture-learning",
    title: "Software Architecture Learning Path",
    root: {
      label: "Software Architecture",
      children: Object.entries(architectureTopics).map(([label, children]) => ({
        label,
        children: children.map((child) => ({ label: child })),
      })),
    },
    layout: { direction: "LR" },
  },
};

export function canonicalDocument(
  input: unknown = flowchartInput,
): CanonicalDiagramDocument {
  return Effect.runSync(decodeCanonicalDiagramDocument(input));
}

export function builtDiagram(
  options: {
    readonly id?: string;
    readonly title?: string;
    readonly document?: CanonicalDiagramDocument;
    readonly png?: Uint8Array;
  } = {},
): BuiltDiagram {
  const baseDocument = options.document ?? canonicalDocument();
  const id = options.id ?? baseDocument.spec.id ?? "release-flow";
  const title = options.title ?? baseDocument.spec.title;
  const document =
    title === baseDocument.spec.title
      ? baseDocument
      : canonicalDocument({
          ...baseDocument,
          spec: { ...baseDocument.spec, title },
        });
  return {
    id,
    type: document.type,
    title,
    document,
    scene: {
      diagramId: id,
      title,
      width: 640,
      height: 480,
      accentColor: "#7c3aed",
      backgroundColor: "#ffffff",
      elements: [],
    },
    excalidraw: {
      type: "excalidraw",
      version: 2,
      source: "https://sketchi.dev",
      elements: [],
      appState: {},
      files: {},
    },
    ...(options.png ? { png: options.png } : {}),
  };
}
