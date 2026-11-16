import { Clock, Effect } from "effect";

import type { StoredDiagram } from "../contracts";
import { relativeTime, resolveDiagramId } from "../diagram-catalog";
import { encodeJson } from "../document";
import { DiagramStore } from "../store/service";
import { Command, Flag } from "../terminal/effect-cli";
import { runReported } from "../terminal/output";
import { headline, row, storageLocation, storedData } from "./present";
import { diagramIdArgument, rootCommand } from "./root";

function showText(diagram: StoredDiagram, now: number, document: boolean): string {
	const { manifest } = diagram;
	const created = manifest.createdAt === undefined ? Number.NaN : Date.parse(manifest.createdAt);
	const earlier = diagram.revisions.map((revision) => String(Number.parseInt(revision, 10)));
	return [
		headline(diagram),
		row("Id", manifest.id),
		...(Number.isFinite(created) ? [row("Created", relativeTime(created, now))] : []),
		...(manifest.prompt === undefined ? [] : [row("Prompt", manifest.prompt)]),
		row(
			"Revision",
			`${String(manifest.revision)}${earlier.length > 0 ? `, earlier ${earlier.join(", ")}` : ""}`,
		),
		...(diagram.authority === "canonical" ? [] : [row("Authority", diagram.authority)]),
		row("Stored", storageLocation(manifest.id)),
		...(document ? ["", encodeJson(diagram.document).trimEnd()] : []),
	].join("\n");
}

export const showCommand = Command.make(
	"show",
	{
		diagramId: diagramIdArgument,
		document: Flag.Boolean("document").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Also print the canonical document JSON."),
		),
	},
	({ diagramId, document }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const store = yield* DiagramStore;
			const now = yield* Clock.currentTimeMillis;
			const operation = resolveDiagramId(diagramId).pipe(Effect.flatMap((id) => store.show(id)));
			yield* runReported(
				"show",
				output,
				operation,
				(diagram) => showText(diagram, now, document),
				storedData,
			);
		}),
).pipe(
	Command.withDescription(
		"Summarize one local diagram: title, type, id, when it was created, the prompt that generated it, its revision and earlier revisions kept for restore, and where it is stored. --document adds the canonical document. --output json always includes the full record: authority, documentAuthoritative, formats, revision paths, createdAt, prompt, and document. This is strictly offline and does not rebuild or mutate the record.",
	),
	Command.withShortDescription("Inspect one local diagram."),
	Command.withExamples([
		{ command: "sketchi show latest", description: "Summarize the newest diagram." },
		{
			command: "sketchi show release-flow --output json",
			description: "Read a record as a stable JSON envelope.",
		},
	]),
);
