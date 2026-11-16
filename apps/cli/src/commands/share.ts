import { Effect } from "effect";

import { resolveDiagramId } from "../diagram-catalog";
import { CliShareError } from "../errors";
import {
	MAX_RENDER_CANVAS_AREA,
	MAX_RENDER_CANVAS_DIMENSION,
	MAX_RENDER_ELEMENT_DIMENSION,
	MAX_RENDER_OUTPUT_PIXELS,
} from "../render/limits";
import { ExcalidrawShare, LinkOpener } from "../share/excalidraw";
import { DiagramStore } from "../store/service";
import { Command, Flag } from "../terminal/effect-cli";
import { OutputWriter, reportFailure, reportSuccess } from "../terminal/output";
import { diagramIdArgument, rootCommand } from "./root";

const SHARE_HINT =
	"this immutable link is a bearer snapshot: anyone with the full URL can decrypt it, so share it only with the intended user. Browser edits do not update this link; after editing, choose Save to… → Export to Link and return the new link for sketchi pull.";

function unsupportedPulledScene() {
	return CliShareError.make({
		code: "unsupported_scene",
		message: "The linked Excalidraw scene cannot be rendered by this Sketchi CLI.",
		hint: "Use only the supported v1 elements and Excalifont text, then export a new link.",
		details: [],
	});
}

export const shareCommand = Command.make(
	"share",
	{
		diagramId: diagramIdArgument,
		// Effect 4.1 makes a Boolean flag without a fallback required; --open stays opt-in.
		open: Flag.Boolean("open").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Hand the bearer link to the default OS browser opener."),
		),
	},
	({ diagramId, open }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const store = yield* DiagramStore;
			const sharing = yield* ExcalidrawShare;
			const opener = yield* LinkOpener;
			const operation = Effect.gen(function* () {
				const id = yield* resolveDiagramId(diagramId);
				const source = yield* store.readExportSource(id, "excalidraw");
				if (source._tag !== "StoredArtifact") {
					return yield* CliShareError.make({
						code: "unsupported_scene",
						message: `Diagram "${id}" has no authoritative Excalidraw artifact.`,
						hint: "Restore or rebuild the diagram before sharing it.",
						details: [],
					});
				}
				const artifact: unknown = yield* Effect.try({
					try: () => JSON.parse(new TextDecoder().decode(source.bytes)),
					catch: unsupportedPulledScene,
				});
				const result = yield* sharing.share(artifact);
				const openResult = open
					? yield* opener.open(result.link)
					: { status: "not_requested" as const };
				return { id, link: result.link, open: openResult, hint: SHARE_HINT };
			});
			yield* operation.pipe(
				Effect.matchEffect({
					onFailure: (error) => reportFailure("share", output, error),
					onSuccess: (result) =>
						Effect.gen(function* () {
							yield* reportSuccess(
								"share",
								output,
								result,
								[
									`shared: ${result.id}`,
									`link: ${result.link}`,
									`open: ${result.open.status}`,
									`hint: ${result.hint}`,
								].join("\n"),
							);
							if (output === "text" && result.open.status === "unconfirmed") {
								const writer = yield* OutputWriter;
								yield* writer.stderr(
									"notice: the OS browser opener could not be confirmed; the share link is still valid.\n",
								);
							}
						}),
				}),
			);
		}),
).pipe(
	Command.withDescription(
		`Encrypt and upload the current authoritative Excalidraw artifact as one immutable excalidraw.com bearer snapshot. This makes exactly one credential-free HTTPS request. The storage service can observe connection metadata, timing, and ciphertext size; retention is uncontrolled, and Sketchi cannot revoke or delete a link. Anyone with the full URL can decrypt it. Supported elements: rectangle, ellipse, diamond, arrow, line, freedraw, text; text must use Excalifont fontFamily 5; files and images are rejected. Render limits: element dimension ${String(MAX_RENDER_ELEMENT_DIMENSION)}, canvas dimension ${String(MAX_RENDER_CANVAS_DIMENSION)}, canvas area ${String(MAX_RENDER_CANVAS_AREA)}, final PNG pixels ${String(MAX_RENDER_OUTPUT_PIXELS)}. --open is opt-in and only confirms whether the OS accepted the request.`,
	),
	Command.withShortDescription("Share an encrypted Excalidraw snapshot."),
);
