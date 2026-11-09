import {
	ICON_RECIPE_INK,
	ICON_RECIPE_PAPER,
	type IconRecipe,
	type IconRecipePart,
} from "@sketchi/diagram-core";

/** The longest name a community icon keeps; also bounds its slug. */
export const COMMUNITY_ICON_NAME_MAX_LENGTH = 48;

/** Collapse whitespace and drop control characters, so a name reads as one line. */
export function cleanCommunityIconName(value: string): string {
	return value
		.normalize("NFC")
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

/** A lowercase kebab-case slug from a name: "Kafka topic!" -> "kafka-topic". */
export function communityIconBaseSlug(name: string): string {
	const slug = name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, COMMUNITY_ICON_NAME_MAX_LENGTH)
		.replace(/-+$/u, "");
	return slug || "icon";
}

/** The fixed colors a recipe draws in, sorted; `ink` and `paper` follow the scene. */
export function communityIconColors(recipe: IconRecipe): string[] {
	const colors = new Set<string>();
	const add = (value: string | undefined) => {
		if (value && value !== ICON_RECIPE_INK && value !== ICON_RECIPE_PAPER && value !== "none") {
			colors.add(value);
		}
	};
	for (const part of recipe.parts) {
		if (part.kind === "text") {
			add(part.color);
			continue;
		}
		add(part.stroke);
		if (part.kind !== "arrow") add(part.fill);
	}
	return [...colors].sort();
}

/** The words a recipe writes, which moderation reads along with the name. */
export function communityIconWords(recipe: IconRecipe): string[] {
	return recipe.parts.flatMap((part: IconRecipePart) => (part.kind === "text" ? [part.text] : []));
}

/** JSON with object keys sorted, so equal recipes hash equally whatever their key order. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** SHA-256 of the recipe's canonical JSON, hex: two uploads of one drawing share it. */
export async function communityIconHash(recipe: IconRecipe): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalJson(recipe)),
	);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
