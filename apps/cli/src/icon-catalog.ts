import { CodeModeIconLoadError, makeCodeModeIconCatalog } from "@sketchi/diagram-agent";
import { iconManifest } from "@sketchi/icon-catalog/catalog";
import nodeLogoSvgs from "@sketchi/icon-catalog/node-logo-svgs";
import { Effect } from "effect";

/** Offline node-logo catalog: the CLI bundles every normalized node-logo SVG. */
export const cliIconCatalog = makeCodeModeIconCatalog({
	icons: iconManifest.icons,
	loadSvg: (icon) => {
		const svg = Object.hasOwn(nodeLogoSvgs, icon.slug) ? nodeLogoSvgs[icon.slug] : undefined;
		return svg === undefined
			? Effect.fail(
					CodeModeIconLoadError.make({
						cause: new Error(`Missing bundled node logo ${icon.slug}.`),
						message: `Node logo ${icon.slug} is not bundled with this CLI.`,
						slug: icon.slug,
					}),
				)
			: Effect.succeed(svg);
	},
	// The offline runtime has no search operation; the catalog site does.
	slugLookup: "https://icons.sketchi.app",
});
