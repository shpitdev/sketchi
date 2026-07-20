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
