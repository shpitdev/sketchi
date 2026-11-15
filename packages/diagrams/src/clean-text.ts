import { String as Str } from "effect";
/**
 * gemini-flash-lite sometimes welds the next JSON key onto the previous
 * string value inside tool-call args ("start-node,kind:", "pass,source:").
 * Strip those trailing key fragments so one sloppy generation doesn't
 * poison the whole attempt loop.
 */
const TRAILING_KEY_FRAGMENT =
	/[,;]\s*(?:id|label|kind|group|source|target|title|direction|nodes|edges)\s*:?\s*$/i;

export function cleanToolString(value: string): string {
	let cleaned = value.trim();
	for (;;) {
		const next = cleaned.replace(TRAILING_KEY_FRAGMENT, "").trim();
		if (next === cleaned) {
			return cleaned;
		}
		cleaned = next;
	}
}

/** Stable ids, with each caller's explicit length and Unicode policy. */
export function slug(
	value: string,
	options: {
		readonly maxLength?: number;
		readonly normalize?: "before-lowercase" | "after-lowercase";
		readonly trimEnd?: boolean;
		readonly unicode?: boolean;
	} = {},
): string {
	const lower = Str.toLowerCase(
		options.normalize === "before-lowercase" ? Str.normalize("NFKD")(value) : value,
	);
	const text = options.normalize === "after-lowercase" ? Str.normalize("NFKD")(lower) : lower;
	const result = Str.slice(
		0,
		options.maxLength ?? 48,
	)(
		Str.replace(
			/^-+|-+$/g,
			"",
		)(Str.replace(options.unicode ? /[^\p{L}\p{N}]+/gu : /[^a-z0-9]+/g, "-")(text)),
	);
	return options.trimEnd ? Str.replace(/-+$/g, "")(result) : result;
}
