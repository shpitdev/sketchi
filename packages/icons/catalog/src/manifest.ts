export interface SketchiIconViewBox {
	readonly height: number;
	readonly minX: number;
	readonly minY: number;
	readonly width: number;
}

export interface SketchiIcon {
	readonly aliases: readonly string[];
	readonly bytes: number;
	readonly collection: string;
	readonly keywords: readonly string[];
	readonly name: string;
	readonly slug: string;
	readonly svgPath: string;
	readonly variant?: string;
	readonly viewBox: SketchiIconViewBox;
}

export interface IconManifest {
	readonly generatedAt?: string;
	readonly icons: readonly SketchiIcon[];
	readonly summary: {
		readonly collectionCounts: Readonly<Record<string, number>>;
		readonly totalIcons: number;
	};
	readonly version: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isViewBox(value: unknown): value is SketchiIconViewBox {
	return (
		isRecord(value) &&
		typeof value.height === "number" &&
		typeof value.minX === "number" &&
		typeof value.minY === "number" &&
		typeof value.width === "number"
	);
}

function isSketchiIcon(value: unknown): value is SketchiIcon {
	return (
		isRecord(value) &&
		isStringArray(value.aliases) &&
		typeof value.bytes === "number" &&
		typeof value.collection === "string" &&
		isStringArray(value.keywords) &&
		typeof value.name === "string" &&
		typeof value.slug === "string" &&
		typeof value.svgPath === "string" &&
		(value.variant === undefined || typeof value.variant === "string") &&
		isViewBox(value.viewBox)
	);
}

function decodeCollectionCounts(value: unknown): Record<string, number> {
	if (!isRecord(value)) {
		throw new Error("Icon manifest collection counts are invalid.");
	}

	const counts: Record<string, number> = {};
	for (const [collection, count] of Object.entries(value)) {
		if (typeof count !== "number") {
			throw new Error(`Icon manifest count for ${collection} is invalid.`);
		}
		counts[collection] = count;
	}
	return counts;
}

export function decodeIconManifest(value: unknown): IconManifest {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!Array.isArray(value.icons) ||
		!value.icons.every(isSketchiIcon) ||
		!isRecord(value.summary) ||
		typeof value.summary.totalIcons !== "number" ||
		(value.generatedAt !== undefined && typeof value.generatedAt !== "string")
	) {
		throw new Error("Icon manifest does not match the public contract.");
	}

	return {
		...(typeof value.generatedAt === "string" ? { generatedAt: value.generatedAt } : {}),
		icons: value.icons,
		summary: {
			collectionCounts: decodeCollectionCounts(value.summary.collectionCounts),
			totalIcons: value.summary.totalIcons,
		},
		version: 1,
	};
}

export function formatCollectionLabel(collection: string): string {
	if (collection === "gcp") return "Google Cloud";
	if (collection === "gcp-legacy") return "Google Cloud Classic";
	return collection
		.split("-")
		.map((part) =>
			["ai", "ci", "iot", "paas"].includes(part)
				? part.toUpperCase()
				: part.charAt(0).toUpperCase() + part.slice(1),
		)
		.join(" ");
}
