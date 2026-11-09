import { isIconRecipe, type IconRecipe } from "@sketchi/diagram-core";
import { Context, Effect, Layer, Schema } from "effect";

import {
	COMMUNITY_ICON_LIMITS,
	CommunityIconStorageError,
	CommunityIconVerdict,
	type CommunityIcon,
} from "./contracts.js";
import { communityIconColors, communityIconSlugCandidates } from "./recipe.js";

/** The slice of a Cloudflare D1 binding the store uses. */
export interface CommunityIconStatement {
	bind(...values: unknown[]): CommunityIconStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<{ meta: { changes?: number } }>;
}

export interface CommunityIconDatabase {
	prepare(query: string): CommunityIconStatement;
}

/**
 * One table: a row per icon, unique by slug and by recipe hash, so a second
 * upload of the same drawing finds the first. Created on first use, so a new
 * database needs no migration step.
 */
const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS community_icons (
		slug TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		recipe TEXT NOT NULL,
		colors TEXT NOT NULL,
		hash TEXT NOT NULL UNIQUE,
		verdict TEXT,
		created_at TEXT NOT NULL,
		hidden INTEGER NOT NULL DEFAULT 0
	)`,
	"CREATE INDEX IF NOT EXISTS community_icons_recent ON community_icons (hidden, created_at DESC, slug DESC)",
];

const COLUMNS = "slug, name, recipe, colors, hash, verdict, created_at, hidden";

interface Row {
	readonly slug: string;
	readonly name: string;
	readonly recipe: string;
	readonly colors: string;
	readonly hash: string;
	readonly verdict: string | null;
	readonly created_at: string;
	readonly hidden: number;
}

/** A stored icon and whether the owner hid it. */
export interface StoredCommunityIcon {
	readonly icon: CommunityIcon;
	readonly hidden: boolean;
}

export interface CommunityIconPage {
	readonly icons: readonly CommunityIcon[];
	/** Pass back as `cursor` for the next page; absent on the last. */
	readonly nextCursor?: string;
}

export interface CommunityIconStoreShape {
	/** A visible icon by bare slug. */
	readonly get: (
		slug: string,
	) => Effect.Effect<CommunityIcon | undefined, CommunityIconStorageError>;
	/** Visible icons by bare slug, in no particular order; unknown and hidden slugs are absent. */
	readonly getMany: (
		slugs: readonly string[],
	) => Effect.Effect<readonly CommunityIcon[], CommunityIconStorageError>;
	/** The icon already published with this recipe hash, hidden or not. */
	readonly findByHash: (
		hash: string,
	) => Effect.Effect<StoredCommunityIcon | undefined, CommunityIconStorageError>;
	/**
	 * Store a new icon under a slug from its name, suffixed by its hash when
	 * another icon has the name. A concurrent insert of the same recipe returns
	 * that row with `created: false`.
	 */
	readonly insert: (input: {
		readonly name: string;
		readonly recipe: IconRecipe;
		readonly hash: string;
		readonly verdict?: CommunityIconVerdict;
	}) => Effect.Effect<
		{ readonly icon: CommunityIcon; readonly created: boolean; readonly hidden: boolean },
		CommunityIconStorageError
	>;
	/** Newest first; `query` matches names and slugs. */
	readonly search: (input: {
		readonly query?: string;
		readonly limit?: number;
		readonly cursor?: string;
	}) => Effect.Effect<CommunityIconPage, CommunityIconStorageError>;
	/** Hide or restore an icon; false when no icon has the slug. */
	readonly setHidden: (
		slug: string,
		hidden: boolean,
	) => Effect.Effect<boolean, CommunityIconStorageError>;
}

export class CommunityIconStore extends Context.Service<
	CommunityIconStore,
	CommunityIconStoreShape
>()("@sketchi/community-icons/CommunityIconStore") {}

const decodeVerdict = Schema.decodeUnknownOption(CommunityIconVerdict);

function parseJson(value: string | null): unknown {
	if (value === null) return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

/** A row as an icon; a row whose recipe no longer draws is skipped. */
function rowIcon(row: Row): StoredCommunityIcon | undefined {
	const recipe = parseJson(row.recipe);
	if (!isIconRecipe(recipe)) return undefined;
	const colors = parseJson(row.colors);
	const verdict = decodeVerdict(parseJson(row.verdict));
	return {
		hidden: row.hidden !== 0,
		icon: {
			slug: row.slug,
			name: row.name,
			recipe,
			colors: Array.isArray(colors)
				? colors.filter((color): color is string => typeof color === "string")
				: [],
			createdAt: row.created_at,
			hash: row.hash,
			...(verdict._tag === "Some" ? { verdict: verdict.value } : {}),
		},
	};
}

/** `%` and `_` match literally in a search. */
function likePattern(query: string): string {
	return `%${query.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
}

function encodeCursor(createdAt: string, slug: string): string {
	return btoa(JSON.stringify([createdAt, slug]))
		.replace(/\+/gu, "-")
		.replace(/\//gu, "_")
		.replace(/=+$/u, "");
}

function decodeCursor(cursor: string | undefined): readonly [string, string] | undefined {
	if (!cursor) return undefined;
	try {
		const value: unknown = JSON.parse(atob(cursor.replace(/-/gu, "+").replace(/_/gu, "/")));
		return Array.isArray(value) &&
			value.length === 2 &&
			typeof value[0] === "string" &&
			typeof value[1] === "string"
			? [value[0], value[1]]
			: undefined;
	} catch {
		return undefined;
	}
}

function pageSize(limit: number | undefined): number {
	if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
		return COMMUNITY_ICON_LIMITS.defaultPageSize;
	}
	return Math.min(limit, COMMUNITY_ICON_LIMITS.maxPageSize);
}

export function makeCommunityIconStore(
	database: CommunityIconDatabase,
	options: { readonly now?: () => Date } = {},
): CommunityIconStoreShape {
	const now = options.now ?? (() => new Date());
	const attempt = <A>(operation: "read" | "write" | "schema", run: () => Promise<A>) =>
		Effect.tryPromise({
			try: run,
			catch: (cause) =>
				CommunityIconStorageError.make({
					cause,
					message: `Community icon ${operation} failed.`,
					operation,
				}),
		});
	// Once per store; concurrent first calls both run the idempotent statements.
	let schemaReady = false;
	const ensureSchema = Effect.suspend(() =>
		schemaReady
			? Effect.void
			: attempt("schema", async () => {
					for (const statement of SCHEMA) await database.prepare(statement).run();
					schemaReady = true;
				}),
	);
	const query = <A>(operation: "read" | "write", run: () => Promise<A>) =>
		ensureSchema.pipe(Effect.andThen(attempt(operation, run)));

	const bySlug = (slug: string) =>
		query("read", () =>
			database
				.prepare(`SELECT ${COLUMNS} FROM community_icons WHERE slug = ?`)
				.bind(slug)
				.first<Row>(),
		).pipe(Effect.map((row) => (row ? rowIcon(row) : undefined)));

	const findByHash = Effect.fn("communityIcons.store.findByHash")(function* (hash: string) {
		const row = yield* query("read", () =>
			database
				.prepare(`SELECT ${COLUMNS} FROM community_icons WHERE hash = ?`)
				.bind(hash)
				.first<Row>(),
		);
		return row ? rowIcon(row) : undefined;
	});

	return {
		get: Effect.fn("communityIcons.store.get")(function* (slug: string) {
			const stored = yield* bySlug(slug);
			return stored && !stored.hidden ? stored.icon : undefined;
		}),
		getMany: Effect.fn("communityIcons.store.getMany")(function* (slugs: readonly string[]) {
			const unique = [...new Set(slugs)].slice(0, COMMUNITY_ICON_LIMITS.maxPerDiagram);
			if (unique.length === 0) return [];
			const { results } = yield* query("read", () =>
				database
					.prepare(
						`SELECT ${COLUMNS} FROM community_icons WHERE hidden = 0 AND slug IN (${unique.map(() => "?").join(", ")})`,
					)
					.bind(...unique)
					.all<Row>(),
			);
			return results.flatMap((row) => {
				const stored = rowIcon(row);
				return stored ? [stored.icon] : [];
			});
		}),
		findByHash,
		insert: Effect.fn("communityIcons.store.insert")(function* (input) {
			const candidates = communityIconSlugCandidates(input.name, input.hash);
			const createdAt = now().toISOString();
			for (const slug of candidates) {
				const result = yield* query("write", () =>
					database
						.prepare(
							`INSERT INTO community_icons (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT DO NOTHING`,
						)
						.bind(
							slug,
							input.name,
							JSON.stringify(input.recipe),
							JSON.stringify(communityIconColors(input.recipe)),
							input.hash,
							input.verdict ? JSON.stringify(input.verdict) : null,
							createdAt,
						)
						.run(),
				);
				if ((result.meta.changes ?? 0) > 0) {
					const stored = yield* bySlug(slug);
					if (stored) return { ...stored, created: true };
				}
				// The slug is taken, or someone published this recipe meanwhile.
				const existing = yield* findByHash(input.hash);
				if (existing) return { ...existing, created: false };
			}
			return yield* CommunityIconStorageError.make({
				cause: new Error(`Every slug for "${input.name}" is taken.`),
				message: "Community icon write failed.",
				operation: "write",
			});
		}),
		search: Effect.fn("communityIcons.store.search")(function* (input) {
			const limit = pageSize(input.limit);
			const text = input.query?.trim().slice(0, 100) ?? "";
			const after = decodeCursor(input.cursor);
			const clauses = ["hidden = 0"];
			const values: unknown[] = [];
			if (text) {
				clauses.push("(name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')");
				values.push(likePattern(text), likePattern(text.replace(/\s+/gu, "-")));
			}
			if (after) {
				clauses.push("(created_at < ? OR (created_at = ? AND slug < ?))");
				values.push(after[0], after[0], after[1]);
			}
			const { results } = yield* query("read", () =>
				database
					.prepare(
						`SELECT ${COLUMNS} FROM community_icons WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, slug DESC LIMIT ?`,
					)
					.bind(...values, limit + 1)
					.all<Row>(),
			);
			const icons = results.slice(0, limit).flatMap((row) => {
				const stored = rowIcon(row);
				return stored ? [stored.icon] : [];
			});
			const last = results[limit - 1];
			return results.length > limit && last
				? { icons, nextCursor: encodeCursor(last.created_at, last.slug) }
				: { icons };
		}),
		setHidden: Effect.fn("communityIcons.store.setHidden")(function* (slug, hidden) {
			const result = yield* query("write", () =>
				database
					.prepare("UPDATE community_icons SET hidden = ? WHERE slug = ?")
					.bind(hidden ? 1 : 0, slug)
					.run(),
			);
			return (result.meta.changes ?? 0) > 0;
		}),
	} satisfies CommunityIconStoreShape;
}

export function communityIconStoreLayer(
	database: CommunityIconDatabase,
	options: { readonly now?: () => Date } = {},
): Layer.Layer<CommunityIconStore> {
	return Layer.succeed(CommunityIconStore, makeCommunityIconStore(database, options));
}
