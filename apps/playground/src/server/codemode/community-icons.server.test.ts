// @vitest-environment node

import { DatabaseSync } from "node:sqlite";

import {
	COMMUNITY_ICON_LIMITS,
	type CommunityIconDatabase,
	type CommunityIconStatement,
} from "@sketchi/community-icons";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import { studioCommunityIcons } from "./community-icons.server";

function sqliteDatabase(): CommunityIconDatabase {
	const sqlite = new DatabaseSync(":memory:");
	const statement = (query: string, values: unknown[] = []): CommunityIconStatement => {
		const params = values as (string | number | null)[];
		return {
			bind: (...next) => statement(query, next),
			first: async <T>() => (sqlite.prepare(query).get(...params) as T | undefined) ?? null,
			all: async <T>() => ({ results: sqlite.prepare(query).all(...params) as T[] }),
			run: async () => ({
				meta: { changes: Number(sqlite.prepare(query).run(...params).changes) },
			}),
		};
	};
	return { prepare: (query) => statement(query) };
}

const RING = { parts: [{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 }] };

describe("Studio community icons", () => {
	it("loads published icons by their community slugs", async () => {
		const database = sqliteDatabase();
		const source = studioCommunityIcons(database);
		expect(await Effect.runPromise(source.load(["community/ring"]))).toEqual([]);
		await database
			.prepare(
				"INSERT INTO community_icons (slug, name, recipe, colors, hash, verdict, created_at, hidden) VALUES (?, ?, ?, '[]', 'h1', NULL, '2026-11-08T00:00:00.000Z', 0)",
			)
			.bind("ring", "Ring", JSON.stringify(RING))
			.run();
		expect(await Effect.runPromise(source.load(["community/ring", "community/missing"]))).toEqual([
			{ slug: "community/ring", name: "Ring", recipe: RING },
		]);
		expect(studioCommunityIcons(database)).toBe(source);
	});

	it("searches visible icons only, under their community slugs", async () => {
		const database = sqliteDatabase();
		const source = studioCommunityIcons(database);
		expect(await Effect.runPromise(source.search("ring"))).toEqual([]);
		for (const [slug, hidden] of [
			["ring", 0],
			["ring-hidden", 1],
		] as const) {
			await database
				.prepare(
					"INSERT INTO community_icons (slug, name, recipe, colors, hash, verdict, created_at, hidden) VALUES (?, ?, ?, '[]', ?, NULL, '2026-11-08T00:00:00.000Z', ?)",
				)
				.bind(slug, "Ring", JSON.stringify(RING), slug, hidden)
				.run();
		}
		expect(await Effect.runPromise(source.search("ring"))).toEqual([
			{ slug: "community/ring", name: "Ring", recipe: RING },
		]);
	});

	it("finds the icon a query names exactly behind a full page of newer partial matches", async () => {
		const database = sqliteDatabase();
		const source = studioCommunityIcons(database);
		expect(await Effect.runPromise(source.search("Acme"))).toEqual([]);
		const insert = (slug: string, name: string, createdAt: string) =>
			database
				.prepare(
					"INSERT INTO community_icons (slug, name, recipe, colors, hash, verdict, created_at, hidden) VALUES (?, ?, ?, '[]', ?, NULL, ?, 0)",
				)
				.bind(slug, name, JSON.stringify(RING), slug, createdAt)
				.run();
		await insert("acme", "Acme", "2026-11-01T00:00:00.000Z");
		for (let index = 0; index < COMMUNITY_ICON_LIMITS.maxPageSize; index += 1) {
			await insert(`acme-old-${index}`, `Acme old ${index}`, "2026-11-08T00:00:00.000Z");
		}
		const found = await Effect.runPromise(source.search("Acme"));
		expect(found[0]).toEqual({ slug: "community/acme", name: "Acme", recipe: RING });
		expect(found).toHaveLength(COMMUNITY_ICON_LIMITS.maxPageSize + 1);
	});

	it("draws no community icons when the store cannot be read", async () => {
		const broken: CommunityIconDatabase = {
			prepare: () => {
				throw new Error("D1 unavailable");
			},
		};
		expect(await Effect.runPromise(studioCommunityIcons(broken).load(["community/ring"]))).toEqual(
			[],
		);
		expect(await Effect.runPromise(studioCommunityIcons(broken).search("ring"))).toEqual([]);
	});
});
