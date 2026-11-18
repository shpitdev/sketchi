import { join } from "node:path";

import { Effect } from "effect";

import type { DiagramFormat } from "../contracts";
import { CliExportError } from "../errors";
import { isValidPng } from "../render/png-validate";
import { artifactFile, recordPath, storageError } from "./entries";
import type { makeLocks } from "./locks";
import type { makeRecordReader } from "./record";
import type { ExportSource, StoreContext } from "./service";

export function makeRead(
	{ fs, root }: StoreContext,
	{ withLock }: ReturnType<typeof makeLocks>,
	{ loadUnlocked }: ReturnType<typeof makeRecordReader>,
) {
	const show = Effect.fn("sketchi.cli.storage.show")((diagramId: string) =>
		withLock(diagramId, loadUnlocked(diagramId), true),
	);

	const readExportSource = Effect.fn("sketchi.cli.storage.readExportSource")(function* (
		diagramId: string,
		format: DiagramFormat,
	) {
		return yield* withLock(
			diagramId,
			Effect.gen(function* () {
				const stored = yield* loadUnlocked(diagramId);
				if (stored.manifest.formats.includes(format)) {
					const bytes = yield* fs.readBytes(
						join(recordPath(root.path, diagramId), artifactFile(format)),
					);
					if (format === "png" && !isValidPng(bytes)) {
						return yield* storageError(
							"corrupt_record",
							`Diagram "${diagramId}" has an invalid stored PNG artifact.`,
							"Recover a valid prior revision or rebuild the record.",
							diagramId,
						);
					}
					return { _tag: "StoredArtifact", bytes } satisfies ExportSource;
				}
				if (format !== "png") {
					return yield* CliExportError.make({
						code: "format_unavailable",
						format,
						message: `Diagram "${diagramId}" has no stored ${format} artifact.`,
						hint: "Edit the diagram to rebuild its local artifacts.",
					});
				}
				if (stored.authority === "detached") {
					return {
						_tag: "RenderPng",
						excalidraw: yield* fs.readBytes(
							join(recordPath(root.path, diagramId), artifactFile("excalidraw")),
						),
					} as const;
				}
				for (const renderFormat of ["scene", "excalidraw"] as const) {
					if (!stored.manifest.formats.includes(renderFormat)) {
						return yield* CliExportError.make({
							code: "format_unavailable",
							format: renderFormat,
							message: `Diagram "${diagramId}" has no stored ${renderFormat} artifact.`,
							hint: "Edit the diagram to rebuild its local artifacts.",
						});
					}
				}
				const [scene, excalidraw] = yield* Effect.all([
					fs.readBytes(join(recordPath(root.path, diagramId), artifactFile("scene"))),
					fs.readBytes(join(recordPath(root.path, diagramId), artifactFile("excalidraw"))),
				]);
				return { _tag: "RenderPng", scene, excalidraw } as const;
			}),
			true,
		);
	});

	return { show, readExportSource };
}
