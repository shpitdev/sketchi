import { getIconBySlug } from "./catalog.js";
import lookAlikesJson from "./generated/look-alikes.json" with { type: "json" };
import { markDistance, type MarkFeatures } from "./mark-features.js";

/** Catalog marks and uploads are measured at this longest side. */
export const LOOK_ALIKE_RENDER_SIZE = 256;
/** Below this distance two marks are the same drawing under different names. */
const SAME_MARK_DISTANCE = 0.02;

export interface LookAlikeMark extends MarkFeatures {
	/** FNV-1a of the source SVG the features were measured from. */
	readonly hash: string;
}

/** Features of every node-logo mark, by slug. */
export const lookAlikeMarks: Readonly<Record<string, LookAlikeMark>> = (
	lookAlikesJson as unknown as { marks: Record<string, LookAlikeMark> }
).marks;

/** FNV-1a (32-bit, hex) of a source file, to tell when its features are stale. */
export function lookAlikeSourceHash(source: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function words(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, " ")
		.trim();
}

/** A name without spaces, case or a trailing version number: `Netlify 2` and `netlify2` are `netlify`. */
function compact(value: string): string {
	return words(value).replace(/ /gu, "").replace(/\d+$/u, "");
}

/** Whether a catalog mark is the brand the caller named, under any of its names or versions. */
function namesMark(name: string, slug: string): boolean {
	const wanted = compact(name);
	const icon = getIconBySlug(slug);
	return [slug, icon?.name ?? "", ...(icon?.aliases ?? [])].some(
		(term) => compact(term) === wanted,
	);
}

export interface LookAlike {
	readonly slug: string;
	readonly distance: number;
}

/**
 * The catalog marks a new mark most resembles in color, layout and proportion,
 * nearest first: never the brand it names, never the same drawing twice.
 */
export function rankLookAlikes(
	features: MarkFeatures,
	options: { readonly name: string; readonly count: number },
): LookAlike[] {
	const ranked = Object.entries(lookAlikeMarks)
		.map(([slug, mark]) => ({ slug, mark, distance: markDistance(features, mark) }))
		.filter(
			({ slug, distance }) => distance >= SAME_MARK_DISTANCE && !namesMark(options.name, slug),
		)
		.sort((left, right) => left.distance - right.distance || left.slug.localeCompare(right.slug));
	const chosen: typeof ranked = [];
	for (const candidate of ranked) {
		if (chosen.length >= options.count) break;
		if (chosen.some((other) => markDistance(other.mark, candidate.mark) < SAME_MARK_DISTANCE))
			continue;
		chosen.push(candidate);
	}
	return chosen.map(({ slug, distance }) => ({
		slug,
		distance: Math.round(distance * 1000) / 1000,
	}));
}
