import { Effect } from "effect";

import { DiagramBuilder } from "../builder";
import { resolveDiagramId } from "../diagram-catalog";
import { DiagramStore } from "../store/service";
import { Command, Flag } from "../terminal/effect-cli";
import { runReported } from "../terminal/output";
import { revisionLocations } from "./present";
import { diagramIdArgument, rootCommand } from "./root";

export const restoreCommand = Command.make(
	"restore",
	{
		diagramId: diagramIdArgument,
		revision: Flag.Int("revision").pipe(
			Flag.filter(
				(revision) => revision > 0,
				(revision) => `Expected a positive revision, got ${String(revision)}`,
			),
			Flag.withMetavar("N"),
			Flag.withDescription("Archived revision number to restore without consuming it."),
		),
	},
	({ diagramId, revision }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const store = yield* DiagramStore;
			const builder = yield* DiagramBuilder;
			const operation = Effect.gen(function* () {
				const id = yield* resolveDiagramId(diagramId);
				const selected = yield* store.readRevision(id, revision);
				const restored =
					selected._tag === "LegacyDocument"
						? yield* builder
								.build(selected.document)
								.pipe(Effect.flatMap((built) => store.restore(id, revision, built)))
						: yield* store.restore(id, revision);
				return restored;
			});
			yield* runReported(
				"restore",
				output,
				operation,
				(result) =>
					[
						`restored: ${result.diagram.manifest.id}`,
						`from revision: ${String(result.restoredFromRevision)}`,
						`revision: ${String(result.diagram.manifest.revision)}`,
						`authority: ${result.diagram.authority}`,
					].join("\n"),
				(result) => ({
					id: result.diagram.manifest.id,
					restoredFromRevision: result.restoredFromRevision,
					revision: result.diagram.manifest.revision,
					authority: result.diagram.authority,
					documentAuthoritative: result.diagram.authority === "canonical",
					formats: result.diagram.manifest.formats,
					revisions: revisionLocations(result.diagram),
				}),
			);
		}),
).pipe(
	Command.withDescription(
		"Strictly offline recovery. Archive the current full state first, then restore revision N byte-for-byte without consuming it and commit at the next monotonic revision. Full snapshots restore artifacts and authority without rebuilding; legacy document-only revisions rebuild only while the record remains canonical.",
	),
	Command.withShortDescription("Restore a retained diagram revision."),
);
