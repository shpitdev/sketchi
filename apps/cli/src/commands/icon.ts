import { Effect, Option } from "effect";

import {
	drawIcons,
	iconDrawText,
	resolveCommunityEndpoint,
	resolveIconDrawEndpoint,
	SKETCHI_COMMUNITY_ENDPOINT_ENV,
	SKETCHI_ICON_DRAW_ENDPOINT_ENV,
} from "../icon-draw.js";
import { Argument, Command, Flag } from "../terminal/effect-cli.js";
import { runReported } from "../terminal/output.js";
import { rootCommand } from "./root.js";

const ICON_DRAW_HELP = `Draw a logo as a hand-drawn Sketchi icon. Sketchi sends the logo (an SVG, or a PNG, JPEG or WebP) and its name to the public Sketchi icon service in one unauthenticated HTTPS POST per logo; a model draws it as a few Excalidraw parts, checks it at 28 px against the source, and a judge from another model family tries to pick it out of four look-alike logos.

  PATH is one logo file, or a folder: every .svg, .png, .jpg, .jpeg and .webp directly in it is drawn,
  named after its file, and the folder also gets one <folder>.excalidrawlib pack of them all.
  --name NAME is the brand or product name for one file; it defaults to the file's name.
  For each logo it writes <name>.excalidrawlib (one library item to drop into Excalidraw),
  <name>.28.png and <name>.112.png previews, and <name>.recipe.json, into --dest (this directory by
  default). A drawing the judge did not pick out is still written, marked with !.
  --publish adds each drawn icon to the public community set at icons.sketchi.app with the judge's
  verdict, and prints its page.
  --model MODEL asks for another author model the service offers.
  The service limits how many logos one client draws a minute; Sketchi waits out a short limit. Override
  the service with ${SKETCHI_ICON_DRAW_ENDPOINT_ENV} or --endpoint URL, the store with
  ${SKETCHI_COMMUNITY_ENDPOINT_ENV}. One logo that fails does not stop a folder; the command fails only
  when nothing was drawn. Exit codes: 3 unreadable input, 4 logo refused, 10 network, rate limit or
  publish failure, 11 timeout, 12 malformed response.`;

const iconDrawCommand = Command.make(
	"draw",
	{
		path: Argument.String("path").pipe(
			Argument.withDescription("A logo file (.svg, .png, .jpg, .webp), or a folder of them."),
		),
		name: Flag.optional(
			Flag.String("name").pipe(
				Flag.withDescription("The logo's brand or product name; defaults to the file's name."),
				Flag.withMetavar("NAME"),
			),
		),
		dest: Flag.String("dest").pipe(
			Flag.withDefault("."),
			Flag.withDescription("Directory for the icon files."),
			Flag.withMetavar("DIR"),
		),
		model: Flag.optional(
			Flag.String("model").pipe(
				Flag.withDescription("An author model the service offers; omit for its default."),
				Flag.withMetavar("MODEL"),
			),
		),
		publish: Flag.Boolean("publish").pipe(
			Flag.withDefault(false),
			Flag.withDescription("Also add each drawn icon to the public community set."),
		),
		endpoint: Flag.String("endpoint").pipe(
			Flag.withDefault(resolveIconDrawEndpoint()),
			Flag.withDescription("Unauthenticated icon draw API URL; defaults to production."),
			Flag.withMetavar("URL"),
		),
	},
	({ dest, endpoint, model, name, path, publish }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			yield* runReported(
				"icon draw",
				output,
				drawIcons({
					path,
					dest,
					endpoint,
					...(Option.isSome(name) ? { name: name.value } : {}),
					...(Option.isSome(model) ? { model: model.value } : {}),
					...(publish ? { publish: { endpoint: resolveCommunityEndpoint() } } : {}),
				}),
				iconDrawText,
			);
		}),
).pipe(
	Command.withDescription(ICON_DRAW_HELP),
	Command.withShortDescription("Hand-draw a logo as an Excalidraw icon."),
	Command.withExamples([
		{
			command: 'sketchi icon draw acme.svg --name "Acme"',
			description: "Draw one logo and write its library, previews and recipe here.",
		},
		{
			command: "sketchi icon draw logos/ --dest icons --publish",
			description: "Draw a folder as one pack and publish each icon.",
		},
	]),
);

export const iconCommand = Command.make("icon").pipe(
	Command.withDescription("Hand-drawn icons from logos."),
	Command.withShortDescription("Hand-draw a logo as an Excalidraw icon."),
	Command.withSubcommands([iconDrawCommand]),
);
