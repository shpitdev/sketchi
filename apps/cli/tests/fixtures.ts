import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { makeLocalFileSystem } from "../src/filesystem";

import type { BuiltDiagram } from "../src/contracts";
import { decodeCanonicalDiagramDocument, type CanonicalDiagramDocument } from "../src/document";

export const localFileSystemLive = Effect.runSync(
	Effect.map(FileSystem.FileSystem, makeLocalFileSystem).pipe(Effect.provide(NodeFileSystem.layer)),
);

/**
 * Network commands send through FetchHttpClient, whose default transport is the global fetch
 * captured once. Tests swap `globalThis.fetch` per case, so they read it on every request.
 */
export const swappableFetch = Layer.succeed(FetchHttpClient.Fetch, (input, init) =>
	// @effect-diagnostics-next-line globalFetch:off -- Forward to the current fetch stub; the CLI test replaces it between cases.
	globalThis.fetch(input, init),
);

export const flowchartInput = {
	type: "flowchart",
	spec: {
		id: "release-flow",
		title: "Release approval",
		nodes: {
			start: "Change proposed",
			review: "Review evidence",
			end: "Release approved",
		},
		edges: [
			["start", "review"],
			["review", "end"],
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

export const sequenceInput = {
	type: "sequence",
	spec: {
		id: "checkout-sequence",
		title: "Checkout request sequence",
		participants: [
			{ id: "browser", label: "Browser" },
			{ id: "api", label: "API" },
			{ id: "database", label: "Database" },
		],
		messages: [
			{
				id: "login",
				source: "browser",
				target: "api",
				label: "Login request",
			},
			{
				id: "lookup",
				source: "api",
				target: "database",
				label: "Look up user",
			},
			{
				id: "record",
				source: "database",
				target: "api",
				label: "User record",
				type: "return",
			},
			{
				id: "success",
				source: "api",
				target: "browser",
				label: "Authentication success",
				type: "return",
			},
		],
	},
} as const;

/** Compact canonical fixtures derived from the 2026-09-04 production probes. */
export function canonicalDocument(input: unknown = flowchartInput): CanonicalDiagramDocument {
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
			kind: "canvas",
			version: 1,
			diagramId: id,
			title,
			width: 640,
			height: 480,
			accentColor: "#7c3aed",
			backgroundColor: "#ffffff",
			elements: [],
			layers: [],
			layouts: [],
			zOrder: [],
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
