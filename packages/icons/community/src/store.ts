import { isIconRecipe, type IconRecipe } from "@sketchi/drawing";
import { D1Client } from "@effect/sql-d1";
import { Array, Context, DateTime, Effect, Layer, Option, Schema, String } from "effect";

import {
	COMMUNITY_ICON_LIMITS,
	CommunityIconStorageError,
	CommunityIconVerdict,
	type CommunityIcon,
} from "./contracts.js";
import { communityIconColors, communityIconSlugCandidates } from "./recipe.js";

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS community_icons (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, recipe TEXT NOT NULL, colors TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE, verdict TEXT, created_at TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0
 )`,
	"CREATE INDEX IF NOT EXISTS community_icons_recent ON community_icons (hidden, created_at DESC, slug DESC)",
];
const COLUMNS = "slug, name, recipe, colors, hash, verdict, created_at, hidden";
const Row = Schema.Struct({
	slug: Schema.String,
	name: Schema.String,
	recipe: Schema.String,
	colors: Schema.String,
	hash: Schema.String,
	verdict: Schema.NullOr(Schema.String),
	created_at: Schema.String,
	hidden: Schema.Number,
});
type Row = typeof Row.Type;
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Row));
const json = Schema.fromJsonString(Schema.Unknown);
const decodeJson = Schema.decodeUnknownOption(json);
const encodeJson = Schema.encodeEffect(json);
const decodeVerdict = Schema.decodeUnknownOption(CommunityIconVerdict);

export interface StoredCommunityIcon {
	readonly icon: CommunityIcon;
	readonly hidden: boolean;
}
export interface CommunityIconPage {
	readonly icons: readonly CommunityIcon[];
	readonly nextCursor?: string;
}
export interface CommunityIconStoreShape {
	readonly get: (
		slug: string,
	) => Effect.Effect<CommunityIcon | undefined, CommunityIconStorageError>;
	readonly getMany: (
		slugs: readonly string[],
	) => Effect.Effect<readonly CommunityIcon[], CommunityIconStorageError>;
	readonly findByHash: (
		hash: string,
	) => Effect.Effect<StoredCommunityIcon | undefined, CommunityIconStorageError>;
	readonly insert: (input: {
		readonly name: string;
		readonly recipe: IconRecipe;
		readonly hash: string;
		readonly verdict?: CommunityIconVerdict;
	}) => Effect.Effect<
		{ readonly icon: CommunityIcon; readonly created: boolean; readonly hidden: boolean },
		CommunityIconStorageError
	>;
	readonly search: (input: {
		readonly query?: string;
		readonly limit?: number;
		readonly cursor?: string;
	}) => Effect.Effect<CommunityIconPage, CommunityIconStorageError>;
	readonly setHidden: (
		slug: string,
		hidden: boolean,
	) => Effect.Effect<boolean, CommunityIconStorageError>;
}
export class CommunityIconStore extends Context.Service<
	CommunityIconStore,
	CommunityIconStoreShape
>()("@sketchi/community-icons/CommunityIconStore") {}

function rowIcon(row: Row): StoredCommunityIcon | undefined {
	const recipe = Option.getOrUndefined(decodeJson(row.recipe));
	if (!isIconRecipe(recipe)) return undefined;
	const colors = Option.getOrUndefined(decodeJson(row.colors));
	const verdict = decodeVerdict(
		row.verdict === null ? undefined : Option.getOrUndefined(decodeJson(row.verdict)),
	);
	return {
		hidden: row.hidden !== 0,
		icon: {
			slug: row.slug,
			name: row.name,
			recipe,
			colors: Array.isArray(colors)
				? Array.filter(colors, (color): color is string => typeof color === "string")
				: [],
			createdAt: row.created_at,
			hash: row.hash,
			...(Option.isSome(verdict) ? { verdict: verdict.value } : {}),
		},
	};
}
function likePattern(query: string): string {
	// @effect-diagnostics-next-line preferEffectString:off -- The SQL LIKE escape requires a replacement callback, which Effect String.replace does not support.
	return `%${query.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
}
const Cursor = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));
const decodeCursorJson = Schema.decodeUnknownOption(Cursor);
const encodeCursorJson = Schema.encodeEffect(Cursor);
const decodeCursor = (cursor: string | undefined) =>
	cursor
		? Effect.try(() => atob(String.replaceAll("_", "/")(String.replaceAll("-", "+")(cursor)))).pipe(
				Effect.map(decodeCursorJson),
				Effect.orElseSucceed(() => Option.none()),
			)
		: Effect.succeed(Option.none<readonly [string, string]>());
const encodeCursor = (createdAt: string, slug: string) =>
	encodeCursorJson([createdAt, slug]).pipe(
		Effect.map((text) => btoa(text)),
		Effect.map(String.replaceAll("+", "-")),
		Effect.map(String.replaceAll("/", "_")),
		Effect.map(String.replace(/=+$/u, "")),
	);
function pageSize(limit: number | undefined): number {
	return limit === undefined || !Number.isInteger(limit) || limit < 1
		? COMMUNITY_ICON_LIMITS.defaultPageSize
		: Math.min(limit, COMMUNITY_ICON_LIMITS.maxPageSize);
}
const storageError = (operation: "read" | "write" | "schema") => (cause: unknown) =>
	CommunityIconStorageError.make({
		cause,
		message: `Community icon ${operation} failed.`,
		operation,
	});

const storeLayer = Layer.effect(
	CommunityIconStore,
	Effect.gen(function* () {
		const sql = yield* D1Client.D1Client;
		yield* sql
			.batch(Array.map(SCHEMA, (statement) => sql.unsafe(statement)))
			.pipe(Effect.mapError(storageError("schema")));
		const bySlug = (slug: string) =>
			sql`SELECT ${sql.literal(COLUMNS)} FROM community_icons WHERE slug = ${slug}`.pipe(
				Effect.flatMap(decodeRows),
				Effect.map((rows) => (rows[0] ? rowIcon(rows[0]) : undefined)),
				Effect.mapError(storageError("read")),
			);
		const findByHash = Effect.fn("communityIcons.store.findByHash")(
			function* (hash: string) {
				const rows =
					yield* sql`SELECT ${sql.literal(COLUMNS)} FROM community_icons WHERE hash = ${hash}`.pipe(
						Effect.flatMap(decodeRows),
					);
				return rows[0] ? rowIcon(rows[0]) : undefined;
			},
			Effect.mapError(storageError("read")),
		);
		return CommunityIconStore.of({
			get: Effect.fn("communityIcons.store.get")(function* (slug: string) {
				const stored = yield* bySlug(slug);
				return stored && !stored.hidden ? stored.icon : undefined;
			}),
			getMany: Effect.fn("communityIcons.store.getMany")(
				function* (slugs: readonly string[]) {
					const unique = Array.take(Array.dedupe(slugs), COMMUNITY_ICON_LIMITS.maxPerDiagram);
					if (unique.length === 0) return [];
					const rows =
						yield* sql`SELECT ${sql.literal(COLUMNS)} FROM community_icons WHERE hidden = 0 AND ${sql.in("slug", unique)}`.pipe(
							Effect.flatMap(decodeRows),
						);
					return Array.flatMap(rows, (row) => {
						const stored = rowIcon(row);
						return stored ? [stored.icon] : [];
					});
				},
				Effect.mapError(storageError("read")),
			),
			findByHash,
			insert: Effect.fn("communityIcons.store.insert")(
				function* (input) {
					const candidates = communityIconSlugCandidates(input.name, input.hash);
					const createdAt = DateTime.formatIso(yield* DateTime.now);
					const recipe = yield* encodeJson(input.recipe);
					const colors = yield* encodeJson(communityIconColors(input.recipe));
					const verdict = input.verdict ? yield* encodeJson(input.verdict) : null;
					for (const slug of candidates) {
						// The unique slug/hash constraints are the authority, including concurrent publishers.
						const inserted =
							yield* sql`INSERT INTO community_icons (${sql.literal(COLUMNS)}) VALUES (${slug},${input.name},${recipe},${colors},${input.hash},${verdict},${createdAt},0) ON CONFLICT DO NOTHING RETURNING ${sql.literal(COLUMNS)}`.pipe(
								Effect.flatMap(decodeRows),
								Effect.uninterruptible,
							);
						if (inserted[0]) {
							const stored = rowIcon(inserted[0]);
							if (stored) return { ...stored, created: true };
						}
						const existing = yield* findByHash(input.hash);
						if (existing) return { ...existing, created: false };
					}
					return yield* CommunityIconStorageError.make({
						cause: new Error(`Every slug for "${input.name}" is taken.`),
						message: "Community icon write failed.",
						operation: "write",
					});
				},
				Effect.mapError(storageError("write")),
			),
			search: Effect.fn("communityIcons.store.search")(
				function* (input) {
					const limit = pageSize(input.limit);
					const text = String.slice(0, 100)(String.trim(input.query ?? ""));
					const after = yield* decodeCursor(input.cursor);
					const clauses = [sql`hidden = 0`];
					if (text)
						clauses.push(
							sql`(name LIKE ${likePattern(text)} ESCAPE '\\' OR slug LIKE ${likePattern(String.replace(/\s+/gu, "-")(text))} ESCAPE '\\')`,
						);
					if (Option.isSome(after))
						clauses.push(
							sql`(created_at < ${after.value[0]} OR (created_at = ${after.value[0]} AND slug < ${after.value[1]}))`,
						);
					const rows =
						yield* sql`SELECT ${sql.literal(COLUMNS)} FROM community_icons WHERE ${sql.join(" AND ")(clauses)} ORDER BY created_at DESC, slug DESC LIMIT ${limit + 1}`.pipe(
							Effect.flatMap(decodeRows),
						);
					const icons = Array.flatMap(Array.take(rows, limit), (row) => {
						const stored = rowIcon(row);
						return stored ? [stored.icon] : [];
					});
					const last = rows[limit - 1];
					return rows.length > limit && last
						? { icons, nextCursor: yield* encodeCursor(last.created_at, last.slug) }
						: { icons };
				},
				Effect.mapError(storageError("read")),
			),
			setHidden: Effect.fn("communityIcons.store.setHidden")(
				function* (slug, hidden) {
					const changed =
						yield* sql`UPDATE community_icons SET hidden = ${hidden ? 1 : 0} WHERE slug = ${slug} RETURNING slug`.pipe(
							Effect.uninterruptible,
						);
					return changed.length > 0;
				},
				Effect.mapError(storageError("write")),
			),
		});
	}),
);
/** Each host request owns one initialized store and native prepared-statement cache. */
export const communityIconStoreLayer = (database: D1Client.D1ClientConfig["db"]) =>
	storeLayer.pipe(Layer.provide(D1Client.layer({ db: database }).pipe(Layer.orDie)));
