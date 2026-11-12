import { CodeModeIconLoadError, makeCodeModeIconCatalog } from "@sketchi/diagram-agent";
import { iconManifest } from "@sketchi/icon-catalog/catalog";
import { CONCEPT_ICONS } from "@sketchi/icon-catalog/concepts";
import nativeIcons from "@sketchi/icon-catalog/native-icons";
import { Effect } from "effect";
import { gunzipSync } from "node:zlib";

/** Every node logo's SVG by slug, gzipped into the build (see scripts/build.mjs). */
declare const __SKETCHI_NODE_LOGOS_GZIP_BASE64__: string;

let nodeLogoSvgs: Readonly<Record<string, string>> | undefined;

/** The bundled node-logo SVGs, unpacked on first use: most commands never draw a logo. */
function bundledNodeLogoSvgs(): Readonly<Record<string, string>> {
	nodeLogoSvgs ??= JSON.parse(
		gunzipSync(Buffer.from(__SKETCHI_NODE_LOGOS_GZIP_BASE64__, "base64")).toString("utf8"),
	) as Record<string, string>;
	return nodeLogoSvgs;
}

/** Offline node-logo catalog: the CLI bundles every hand-drawn recipe and normalized SVG. */
export const cliIconCatalog = makeCodeModeIconCatalog({
	icons: iconManifest.icons,
	concepts: CONCEPT_ICONS,
	loadSvg: (icon) => {
		const svgs = bundledNodeLogoSvgs();
		const svg = Object.hasOwn(svgs, icon.slug) ? svgs[icon.slug] : undefined;
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
	recipes: nativeIcons,
	// The offline runtime has no search operation; the catalog site does.
	slugLookup: "https://icons.sketchi.app",
});
