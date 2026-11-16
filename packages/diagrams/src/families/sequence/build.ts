import { PublishedBuildIssue } from "../../build/result.js";
import { Array, Effect } from "effect";
import { defineBuild } from "../../build/operation.js";
import { BuildIconSource, resolveNodeIcons, embedSceneIcons } from "../../build/icons.js";
import {
	SequenceDocument,
	SequenceDiagram,
	SequenceValidationError,
	SequenceValidationIssueCodeSchema,
	normalizeSequence,
	validateSequenceDiagram,
	counts,
} from "./document.js";
import { renderSequenceDiagram } from "./render.js";

export const sequenceBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "sequence",
	document: SequenceDocument,
	normalized: SequenceDiagram,
	tool: SequenceDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: SequenceValidationError,
	issueCodes: SequenceValidationIssueCodeSchema,
	invalidStatus: "invalid_sequence",
	normalize: normalizeSequence,
	check: validateSequenceDiagram,
	counts,
	issues: (error) =>
		Array.map(error.issues, (entry) => ({
			code: entry.code,
			severity: "error",
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		})),
	resolve: Effect.fn("sequence.resolveIcons")(function* (document: SequenceDocument) {
		const source = yield* BuildIconSource;
		const catalog = yield* source.catalog(document);
		const normalized = normalizeSequence(document);
		// Keep recipes through catalog resolution; the drawn document records only resolved slugs.
		const authored = Array.map(normalized.participants, (participant, index) => ({
			...participant,
			...(document.participants[index]?.icon ? { icon: document.participants[index]?.icon } : {}),
		}));
		const resolved = resolveNodeIcons(
			authored,
			catalog,
			{ noun: "participant", path: "participants" },
			{ fillNamedLogos: source.fillNamedLogos },
		);
		return {
			document: {
				...normalized,
				participants: Array.map(resolved.nodes, ({ icon, ...participant }) =>
					icon?.slug ? { ...participant, icon: { slug: icon.slug } } : participant,
				),
			},
			issues: resolved.issues,
			render: (scene) => embedSceneIcons(scene, catalog),
		};
	}),
	render: (document) => renderSequenceDiagram(document),
	renderHint:
		"Reduce participant label lines, participants, or messages and retry buildSequenceDiagram.",
});
