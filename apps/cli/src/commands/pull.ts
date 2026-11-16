import { Effect } from "effect";

import { resolveDiagramId } from "../diagram-catalog.js";
import {
	MAX_RENDER_CANVAS_AREA,
	MAX_RENDER_CANVAS_DIMENSION,
	MAX_RENDER_ELEMENT_DIMENSION,
	MAX_RENDER_OUTPUT_PIXELS,
} from "../render/limits.js";
import { MAX_SHARE_LINK_LENGTH } from "../share/protocol.js";
import { preflightPullTarget, pullIntoStore } from "../share/pull.js";
import { Command, exactlyOnceStringFlag } from "../terminal/effect-cli.js";
import { InputReader } from "../terminal/input.js";
import { runReported } from "../terminal/output.js";
import { revisionLocations } from "./present.js";
import { diagramIdArgument, rootCommand } from "./root.js";

const readLinkInput = Effect.fn("sketchi.cli.pull.readLink")(function* (link: string) {
	if (link !== "-") return link;
	const reader = yield* InputReader;
	return (yield* reader.read(
		{ _tag: "File", path: "-" },
		{ content: "share link", maxBytes: MAX_SHARE_LINK_LENGTH },
	)).trim();
});

export const pullCommand = Command.make(
	"pull",
	{
		diagramId: diagramIdArgument,
		link: exactlyOnceStringFlag(
			"link",
			"URL|-",
			"Excalidraw bearer share URL, or - for noninteractive stdin.",
		),
	},
	({ diagramId, link }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const operation = Effect.gen(function* () {
				const target = yield* resolveDiagramId(diagramId).pipe(Effect.flatMap(preflightPullTarget));
				const suppliedLink = yield* readLinkInput(link);
				return yield* pullIntoStore(target.id, suppliedLink, target);
			});
			yield* runReported(
				"pull",
				output,
				operation,
				({ diagram }) =>
					[
						`pulled: ${diagram.manifest.id}`,
						`revision: ${String(diagram.manifest.revision)}`,
						`authority: ${diagram.authority}`,
						"source identity: unverified",
					].join("\n"),
				({ diagram, sourceIdentity }) => ({
					id: diagram.manifest.id,
					revision: diagram.manifest.revision,
					authority: diagram.authority,
					documentAuthoritative: diagram.authority === "canonical",
					formats: diagram.manifest.formats,
					revisions: revisionLocations(diagram),
					sourceIdentity,
				}),
			);
		}),
).pipe(
	Command.withDescription(
		`Fetch exactly one current-format excalidraw.com bearer snapshot, decrypt it locally, restore and strictly validate it, prove detached PNG renderability, then atomically preserve the prior full record and replace diagram.excalidraw as detached authority. The link carries no trusted Sketchi identity and may be unrelated to DIAGRAM_ID. This makes exactly one credential-free HTTPS request and never echoes or stores the input link or key. Supported elements: rectangle, ellipse, diamond, arrow, line, freedraw, text; text must use Excalifont fontFamily 5; files, images, external resources, and other fonts are rejected. Render limits: element dimension ${String(MAX_RENDER_ELEMENT_DIMENSION)}, canvas dimension ${String(MAX_RENDER_CANVAS_DIMENSION)}, canvas area ${String(MAX_RENDER_CANVAS_AREA)}, final PNG pixels ${String(MAX_RENDER_OUTPUT_PIXELS)}.`,
	),
	Command.withShortDescription("Pull browser edits from an Excalidraw link."),
);
