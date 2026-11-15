import { String as Str, Array as Arr, Result } from "effect";
import { SKETCHI_DIAGRAM_STYLE } from "@sketchi/drawing";
import { defineBuild } from "../../build/operation.js";
import { type QualityReport } from "../../build/result.js";
import {
	Mindmap,
	MindmapDocument,
	MindmapInputError,
	checkMindmapSize,
	checkMindmapRoot,
	normalizeMindmap,
	type MindmapTopic,
} from "./document.js";
import { renderMindmap } from "./layout.js";
function assess(document: Mindmap, threshold: number): QualityReport {
	const generic: {
		id: string;
		label: string;
	}[] = [];
	let count = 0;
	const visit = (topic: MindmapTopic, path: readonly number[]) => {
		count++;
		if (/^(topic|branch|item|mindmap)$/i.test(Str.trim(topic.label)))
			generic.push({ id: `topic-${Arr.join(Arr.map(path, String), "-")}`, label: topic.label });
		Arr.forEach(topic.children ?? [], (child, index) => visit(child, [...path, index]));
	};
	visit(document.root, [0]);
	const score = Math.max(0, 10 - generic.length * 2);
	return {
		accepted: score >= threshold,
		score,
		threshold,
		summary: { nodeCount: count, edgeCount: count - 1 },
		checks: Arr.map(generic, (node) => ({
			code: "generic_label",
			passed: false,
			severity: "warning",
			message: `Topic "${node.label}" is too generic.`,
			refs: [{ kind: "node", id: node.id }],
		})),
	};
}
export const mindmapBuild = defineBuild({
	name: "mindmap",
	document: MindmapDocument,
	normalized: Mindmap,
	tool: MindmapDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: MindmapInputError,
	invalidStatus: "invalid_mindmap",
	prepare: (input: unknown) => {
		const spec =
			typeof input === "object" && input !== null && "spec" in input ? input.spec : undefined;
		const root =
			typeof spec === "object" && spec !== null && "root" in spec ? spec.root : undefined;
		return Result.map(checkMindmapSize(root), () => input);
	},
	normalize: (document) => normalizeMindmap({ ...document, style: SKETCHI_DIAGRAM_STYLE }),
	check: (document) => checkMindmapRoot(document.root),
	issues: (error) => [
		{
			code: error.code,
			severity: "error",
			stage: "mindmap",
			message: error.message,
			hint: error.hint,
		},
	],
	assess,
	qualityIssue: { code: "generic_label", hint: "Use specific topic labels from the request." },
	render: renderMindmap,
	renderHint: "Simplify the hierarchy or retry with a smaller mindmap.",
});
