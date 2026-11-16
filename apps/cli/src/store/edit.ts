import { Effect } from "effect";

import { DiagramRecordManifest, RECORD_SCHEMA_VERSION, type BuiltDiagram } from "../contracts.js";
import { formatsFor, storageError } from "./entries.js";
import type { makeTransactions } from "./transaction.js";

export function makeEdit({ transition, writeBuilt }: ReturnType<typeof makeTransactions>) {
	const edit = Effect.fn("sketchi.cli.storage.edit")(
		(diagramId: string, diagram: BuiltDiagram, expectedRevision?: number) =>
			transition(
				diagramId,
				(current) =>
					Effect.gen(function* () {
						if (expectedRevision !== undefined && current.manifest.revision !== expectedRevision) {
							return yield* storageError(
								"edit_conflict",
								`Diagram "${diagramId}" changed to revision ${String(current.manifest.revision)} while this edit was based on revision ${String(expectedRevision)}.`,
								"Run sketchi show to see the current record, then make the change again if it is still wanted.",
								diagramId,
							);
						}
						if (current.authority !== "canonical") {
							return yield* storageError(
								"detached_edit",
								`Diagram "${diagramId}" does not have an authoritative canonical document.`,
								"Restore a canonical revision before editing this diagram.",
								diagramId,
							);
						}
						if (diagram.id !== diagramId) {
							return yield* storageError(
								"storage_commit_failed",
								`Edited document id "${diagram.id}" does not match "${diagramId}".`,
								"Keep spec.id equal to the diagram id being edited.",
								diagramId,
							);
						}
						const manifest = DiagramRecordManifest.make({
							schemaVersion: RECORD_SCHEMA_VERSION,
							id: diagramId,
							type: diagram.type,
							title: diagram.title,
							revision: current.manifest.revision + 1,
							authority: "canonical",
							formats: formatsFor("canonical", diagram.png !== undefined),
						});
						return manifest;
					}),
				(stage, _current, manifest) =>
					writeBuilt(stage, diagram).pipe(Effect.as({ manifest, document: diagram.document })),
			).pipe(
				Effect.map((stored) => ({
					...stored,
					...(diagram.warnings?.length ? { warnings: diagram.warnings } : {}),
				})),
			),
	);

	return edit;
}
