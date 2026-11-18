import { mindmapTopics } from "../../families/mindmap/index";
import { parseCanonicalDiagram, renderDiagram } from "../../family";
import {
	canvasBoundTextBox,
	canvasBoundTextInset,
	embedCanvasIcons,
	getCanvasValidationIssues,
} from "@sketchi/drawing";
import { convertSceneToExcalidraw, validateExcalidrawScene } from "@sketchi/drawing/excalidraw";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { type ExportedElement, midWordBreaks } from "./text-fit-helpers";

// The full routing target also runs this former routing coverage at its original size.
// @effect-diagnostics-next-line processEnv:off -- The offline diagnostic runner reads its sample or output options from the invoking environment.
const FULL = process.env["ROUTING_FUZZ"] === "full";

/**
 * Long words, identifiers and URLs every family must fit: each unbreakable run
 * is at most the 24-glyph long-word bound, or breaks at a deliberate boundary.
 */
const LONG_TOKENS = [
	"AuthenticationController",
	"PaymentReconciliationWorker",
	"buildSequenceDiagram",
	"renderer-independent",
	"exportToExcalidrawScene(spec)",
	"https://example.com/api/v1/artifacts/download",
	"a_very_long_snake_case_identifier_name",
	"Unacceptable",
	"internationalization",
	"品質保証レビュー承認待ち",
	"Ship 🚀 release",
	"Retry after the provider\nconfirms the refund",
];

/** Seeded labels of one to three tokens, mixing long tokens with plain words. */
function tokenLabels(seed: number) {
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed / 2_147_483_648;
	};
	const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
	const label = () =>
		Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
			random() < 0.6 ? pick(LONG_TOKENS) : pick(["review", "the", "order", "Stage 2"]),
		).join(" ");
	return { label, random, pick };
}

/** Canonical diagrams of every family whose every text field draws from `LONG_TOKENS`. */
function longTokenDiagrams(count: number) {
	return Array.from({ length: count }, (_, index) => {
		const { label, random } = tokenLabels(20261020 + index);
		const size = 3 + Math.floor(random() * 5);
		const ids = Array.from({ length: size }, (_, i) => `n${i}`);
		const flowchart = {
			id: `flow-${index}`,
			title: label(),
			type: "flowchart",
			nodes: ids.map((id, i) => ({
				id,
				label: label(),
				kind: i === 0 ? "start" : i === size - 1 ? "end" : i === 1 ? "decision" : "process",
			})),
			edges: [
				...ids.slice(1).map((id, i) => ({
					id: `e${i}`,
					source: ids[i]!,
					target: id,
					...(i === 1 ? { label: label() } : {}),
				})),
				{ id: "branch", source: "n1", target: ids.at(-1)!, label: label() },
			],
			layout: {
				direction: (["TB", "BT", "LR", "RL"] as const)[index % 4],
				edgeRouting: "orthogonal",
			},
		};
		const mindmapTitle = label();
		const rootLabel = label();
		const topicLabels = ids.map(() => label());
		const mindmap = {
			id: `mind-${index}`,
			title: mindmapTitle,
			type: "mindmap",
			root: {
				label: rootLabel,
				children: topicLabels.slice(0, 3).map((text, branch) => ({
					label: text,
					...(branch === 0
						? { children: topicLabels.slice(3).map((text) => ({ label: text })) }
						: {}),
				})),
			},
			layout: { direction: "LR" },
		};
		const lanes = [label(), label()];
		const timeline = {
			id: `time-${index}`,
			title: label(),
			type: "timeline",
			events: ids.map((id, i) => ({
				id,
				label: label(),
				date: `2026-0${1 + i}-01`,
				...(i % 3 === 1 ? { end: `2026-0${2 + i}-15` } : {}),
				...(i % 3 === 2 ? { kind: "milestone" } : {}),
				...(random() < 0.5 ? { description: label() } : {}),
				...(index % 2 === 0 ? { lane: lanes[i % 2]! } : {}),
			})),
		};
		const sequence = {
			id: `seq-${index}`,
			title: label(),
			type: "sequence",
			participants: ids.slice(0, Math.min(size, 5)).map((id) => ({ id, label: label() })),
			messages: Array.from({ length: size + 2 }, (_, i) => {
				const source = Math.floor(random() * Math.min(size, 5));
				const target =
					(source + 1 + Math.floor(random() * (Math.min(size, 5) - 1))) % Math.min(size, 5);
				return { id: `s${i}`, source: `n${source}`, target: `n${target}`, label: label() };
			}),
		};
		const stateMachine = {
			id: `state-${index}`,
			title: label(),
			type: "state-machine",
			initial: "n0",
			states: [
				...ids.map((id, i) => ({
					id,
					label: label(),
					...(i >= 2 && i < 4 ? { parent: "composite" } : {}),
				})),
				{ id: "composite", label: label(), initial: ids[2] ?? "n2" },
				{ id: "end", kind: "final" },
			].filter((state) => state.id !== "composite" || ids.length > 2),
			transitions: [
				...ids.slice(1).map((id, i) => ({
					id: `t${i}`,
					source: ids[i]!,
					target: i >= 1 && i < 3 && ids.length > 2 ? (i === 1 ? "composite" : id) : id,
					event: label(),
					...(i % 2 === 0 ? { guard: label() } : { action: label() }),
				})),
				{ id: "loop", source: "n0", target: "n0", event: label() },
				{ id: "done", source: ids.at(-1)!, target: "end" },
			],
		};
		// Drawn last, so the families above keep their seeded text.
		const looks = [
			{},
			{ shape: "database" },
			{ shape: "queue" },
			{ shape: "storage" },
			{ icon: { slug: "github" } },
		] as const;
		const described = {
			...flowchart,
			id: `described-${index}`,
			nodes: flowchart.nodes.map((node) => ({
				...node,
				...(random() < 0.75 ? { description: label() } : {}),
				...(node.kind === "process" ? looks[Math.floor(random() * looks.length)] : {}),
			})),
		};
		return {
			flowchart,
			mindmap,
			timeline,
			sequence,
			"state-machine": stateMachine,
			"described-flowchart": described,
		};
	});
}

/**
 * Where a node description must sit in the export: inside its node's
 * Excalidraw text box, under its centered label and clear of its logo, grouped
 * with all three.
 */
function descriptionDefects(elements: readonly ExportedElement[]): string[] {
	const byId = new Map(elements.map((element) => [element.id, element]));
	return elements.flatMap((description) => {
		if (description.type !== "text" || !description.id.startsWith("description:")) return [];
		const id = description.id.slice("description:".length);
		const shape = byId.get(`node:${id}`)!;
		const label = byId.get(`label:${id}`)!;
		const geometry = {
			shape: shape.type === "diamond" || shape.type === "ellipse" ? shape.type : "rectangle",
			width: shape.width as number,
			height: shape.height as number,
		} as const;
		const composed = (shape.customData as { sketchiShape?: string } | undefined)?.sketchiShape;
		const node = { ...geometry, ...(composed ? { shape: composed as "cylinder" } : {}) };
		const inset = canvasBoundTextInset(node);
		const box = canvasBoundTextBox(node);
		const [left, top] = [(shape.x as number) + inset.x, (shape.y as number) + inset.y];
		const [x, y, width, height] = [
			description.x as number,
			description.y as number,
			description.width as number,
			description.height as number,
		];
		const defects: string[] = [];
		// Its box may reach into the half-font canvas padding, as a label's does.
		const pad = (description.fontSize as number) / 2;
		if (x < left - pad || x + width > left + box.width + pad) defects.push("too wide");
		if (y + height > top + box.height + 0.5) defects.push("below its node's text box");
		if (y < (label.y as number) + (label.height as number) - 0.5) defects.push("on its label");
		const logo = elements.find((element) => element.id.startsWith(`node-${id}-icon`));
		if (logo && (label.y as number) < (logo.y as number) + (logo.height as number))
			defects.push("label on its logo");
		const outerGroup = (element: ExportedElement) => (element.groupIds as string[]).at(-1);
		const outer = outerGroup(shape);
		if (!outer || outerGroup(label) !== outer || outerGroup(description) !== outer)
			defects.push("ungrouped");
		return defects.map((defect) => `${description.id} ${defect}`);
	});
}

describe("text fit fuzz", () => {
	// Every family sizes its containers to whole words: no validator issue and no
	// word broken across lines in the export.
	const diagrams = longTokenDiagrams(FULL ? 24 : 4);
	it.each([
		"flowchart",
		"mindmap",
		"timeline",
		"sequence",
		"state-machine",
		"described-flowchart",
	] as const)("fits long words and identifiers in every %s", (family) => {
		const failures = diagrams.flatMap((specs, index) => {
			const diagram = parseCanonicalDiagram(specs[family]).pipe(Result.getOrThrow);
			const scene = embedCanvasIcons(renderDiagram(diagram).pipe(Result.getOrThrow), (slug) => ({
				name: slug,
				svg: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"/>',
			})).scene;
			const elements = convertSceneToExcalidraw(scene).elements;
			const authored = new Map(
				[
					...("nodes" in diagram ? diagram.nodes : []),
					...(diagram.type === "mindmap" ? mindmapTopics(diagram.root) : []),
					...("participants" in diagram ? diagram.participants : []),
					...("states" in diagram
						? diagram.states.flatMap((state) =>
								state.label ? [{ id: state.id, label: state.label }] : [],
							)
						: []),
				].map((node) => [`node:${node.id}`, node.label]),
			);
			for (const node of "nodes" in diagram ? diagram.nodes : [])
				if ("description" in node && node.description)
					authored.set(`description:${node.id}`, node.description);
			return [
				// A timeline draws its event descriptions its own way.
				...(diagram.type === "flowchart" ? descriptionDefects(elements) : []),
				...(family === "described-flowchart" &&
				!elements.some((element) => element.id.startsWith("description:"))
					? ["no description drawn"]
					: []),
				...getCanvasValidationIssues(scene).map((issue) => issue.code),
				...validateExcalidrawScene({ ...convertSceneToExcalidraw(scene) }).issues.map(
					(issue) => issue.code,
				),
				...elements.flatMap((text) =>
					text.type === "text"
						? midWordBreaks(
								authored.get(String(text.containerId)) ??
									authored.get(text.id) ??
									String(text.originalText),
								String(text.text),
							)
						: [],
				),
			].map((failure) => `${index}: ${failure}`);
		});
		expect(failures).toEqual([]);
	});
});
