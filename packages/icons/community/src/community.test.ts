import { openD1 } from "../tests/d1.js";

import { isDiagramIconSlug, type IconRecipe } from "@sketchi/drawing";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
	CommunityIconModeration,
	communityIconBaseSlug,
	communityIconColors,
	communityIconHash,
	communityIconSlugCandidates,
	communityIconStoreLayer,
	CommunityIconStore,
	publishCommunityIcon,
	type CommunityEnv,
	type CommunityIconModerationInput,
	workersAiCommunityModeration,
} from "./index.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function nativeDatabase() {
	const fixture = await openD1();
	cleanups.push(fixture.dispose);
	return fixture.database;
}
async function openStore(database: NonNullable<CommunityEnv["COMMUNITY_ICONS"]>) {
	const runtime = ManagedRuntime.make(communityIconStoreLayer(database));
	cleanups.push(() => runtime.dispose());
	return runtime.runPromise(CommunityIconStore);
}

const BOX: IconRecipe = {
	parts: [{ kind: "rect", x: 4, y: 4, width: 16, height: 16, stroke: "#2496ed", fill: "#2496ed" }],
};
const RING: IconRecipe = {
	parts: [
		{ kind: "ellipse", cx: 12, cy: 12, rx: 9, ry: 9 },
		{ kind: "text", cx: 12, cy: 12, text: "Q", size: 8 },
	],
};

function moderationLayer(reviewed: CommunityIconModerationInput[], allowed = true) {
	return Layer.succeed(
		CommunityIconModeration,
		CommunityIconModeration.of({
			review: (input) => Effect.sync(() => (reviewed.push(input), { allowed })),
		}),
	);
}

async function run<A, E>(
	effect: Effect.Effect<A, E, CommunityIconStore | CommunityIconModeration>,
	options: {
		readonly database?: NonNullable<CommunityEnv["COMMUNITY_ICONS"]>;
		readonly reviewed?: CommunityIconModerationInput[];
		readonly allowed?: boolean;
	} = {},
) {
	return Effect.runPromise(
		Effect.result(effect).pipe(
			Effect.provide(
				Layer.merge(
					communityIconStoreLayer(options.database ?? (await nativeDatabase())),
					moderationLayer(options.reviewed ?? [], options.allowed),
				),
			),
		),
	);
}

describe("community icon names and recipes", () => {
	it("derives kebab-case slugs from names", () => {
		expect(communityIconBaseSlug("Kafka topic!")).toBe("kafka-topic");
		expect(communityIconBaseSlug("Café  Crème")).toBe("cafe-creme");
		expect(communityIconBaseSlug("✨")).toBe("icon");
		expect(communityIconBaseSlug("a".repeat(80))).toHaveLength(48);
	});

	it("keeps every slug candidate usable as a diagram slug", async () => {
		const hash = await communityIconHash(BOX);
		for (const name of ["Box", "a".repeat(48), "x", "✨"]) {
			const candidates = communityIconSlugCandidates(name, hash);
			expect(new Set(candidates).size).toBe(4);
			for (const slug of candidates) {
				expect(isDiagramIconSlug(`community/${slug}`), slug).toBe(true);
			}
		}
	});

	it("lists only fixed colors", () => {
		expect(communityIconColors(BOX)).toEqual(["#2496ed"]);
		expect(communityIconColors(RING)).toEqual([]);
	});

	it("hashes recipes independently of key order", async () => {
		const reordered = JSON.parse(
			'{"parts":[{"fill":"#2496ed","stroke":"#2496ed","height":16,"width":16,"y":4,"x":4,"kind":"rect"}]}',
		) as IconRecipe;
		expect(await communityIconHash(reordered)).toBe(await communityIconHash(BOX));
		expect(await communityIconHash(RING)).not.toBe(await communityIconHash(BOX));
	});
});

describe("publishCommunityIcon", () => {
	it("stores a moderated icon under a slug from its name", async () => {
		const reviewed: CommunityIconModerationInput[] = [];
		const result = await run(
			publishCommunityIcon({
				name: "  Ring\n queue ",
				recipe: RING,
				verdict: { recognizable: true, score: 0.9, judge: "jev" },
			}),
			{ reviewed },
		);
		expect(result._tag).toBe("Success");
		if (result._tag !== "Success") return;
		expect(result.success.created).toBe(true);
		expect(result.success.icon).toMatchObject({
			slug: "ring-queue",
			name: "Ring queue",
			recipe: RING,
			colors: [],
			verdict: { recognizable: true, score: 0.9, judge: "jev" },
		});
		expect(reviewed).toEqual([{ name: "Ring queue", words: ["Q"] }]);
	});

	it("returns the published icon for the same recipe without moderating again", async () => {
		const database = await nativeDatabase();
		const reviewed: CommunityIconModerationInput[] = [];
		const first = await run(publishCommunityIcon({ name: "Box", recipe: BOX }), {
			database,
			reviewed,
		});
		const second = await run(publishCommunityIcon({ name: "Another box", recipe: BOX }), {
			database,
			reviewed,
		});
		expect(first._tag === "Success" && first.success.icon.slug).toBe("box");
		expect(second._tag === "Success" && second.success).toMatchObject({
			created: false,
			icon: { slug: "box", name: "Box" },
		});
		expect(reviewed).toHaveLength(1);
	});

	it("falls back to a longer hash suffix when the name and its short suffix are taken", async () => {
		const database = await nativeDatabase();
		const name = "q".repeat(48);
		const hash = await communityIconHash(RING);
		const [base, short, longer] = communityIconSlugCandidates(name, hash);
		// Any read creates the table.
		await run(
			Effect.flatMap(CommunityIconStore, (store) => store.get("none")),
			{ database },
		);
		for (const [index, slug] of [base, short].entries()) {
			await database
				.prepare(
					"INSERT INTO community_icons (slug, name, recipe, colors, hash, verdict, created_at, hidden) VALUES (?, 'Taken', ?, '[]', ?, NULL, '2026-01-01T00:00:00.000Z', 0)",
				)
				.bind(slug ?? "", JSON.stringify(BOX), `taken-${index}`)
				.run();
		}
		const result = await run(publishCommunityIcon({ name, recipe: RING }), { database });
		expect(result._tag === "Success" && result.success.icon.slug).toBe(longer);
		expect(isDiagramIconSlug(`community/${longer}`)).toBe(true);
	});

	it("suffixes the slug when another recipe has the name", async () => {
		const database = await nativeDatabase();
		await run(publishCommunityIcon({ name: "Box", recipe: BOX }), { database });
		const second = await run(publishCommunityIcon({ name: "Box", recipe: RING }), { database });
		const hash = await communityIconHash(RING);
		expect(second._tag === "Success" && second.success.icon.slug).toBe(`box-${hash.slice(0, 6)}`);
	});

	it("rejects bodies, names and recipes it cannot publish", async () => {
		const cases = [
			[{ recipe: BOX }, "invalid_request"],
			[{ name: "!!!", recipe: BOX }, "invalid_request"],
			[{ name: "x".repeat(49), recipe: BOX }, "invalid_request"],
			[{ name: "Box", recipe: BOX, verdict: { recognizable: "yes" } }, "invalid_request"],
			[{ name: "Box", recipe: { parts: [] } }, "invalid_recipe"],
		] as const;
		for (const [body, code] of cases) {
			const result = await run(publishCommunityIcon(body));
			expect(result._tag === "Failure" && result.failure).toMatchObject({
				_tag: "CommunityIconInvalidRequestError",
				code,
			});
		}
	});

	it("refuses a word that would clip past the grid, naming it, and still reads one stored before", async () => {
		const wide: IconRecipe = {
			parts: [
				{ kind: "rect", x: 2, y: 14, width: 20, height: 4 },
				{ kind: "text", cx: 12, cy: 9, text: "tinyhttp", size: 8.5 },
			],
		};
		const database = await nativeDatabase();
		const refused = await run(publishCommunityIcon({ name: "Tiny", recipe: wide }), { database });
		expect(refused._tag === "Failure" && refused.failure).toMatchObject({
			_tag: "CommunityIconInvalidRequestError",
			code: "recipe_clips",
			message: expect.stringContaining('"tinyhttp"'),
		});

		const store = await openStore(database);
		await Effect.runPromise(
			store.insert({ name: "Tiny", recipe: wide, hash: await communityIconHash(wide) }),
		);
		const found = await Effect.runPromise(store.search({ query: "tiny" }));
		expect(found.icons.map((icon) => icon.recipe)).toEqual([wide]);
	});

	it("refuses a word that runs over the shape framing it", async () => {
		const frame = {
			kind: "rect",
			x: 2.5,
			y: 2.5,
			width: 19,
			height: 19,
			rounded: true,
			pen: 2,
		} as const;
		const crowded: IconRecipe = {
			parts: [frame, { kind: "text", cx: 12, cy: 7.5, text: "CACHE", size: 5.5 }],
		};
		const refused = await run(publishCommunityIcon({ name: "Cache", recipe: crowded }));
		expect(refused._tag === "Failure" && refused.failure).toMatchObject({
			_tag: "CommunityIconInvalidRequestError",
			code: "recipe_clips",
			message: expect.stringContaining('"CACHE" would be cut off or run over the shape around it'),
		});
		const clear: IconRecipe = {
			parts: [frame, { kind: "text", cx: 12, cy: 8.5, text: "CACHE", size: 5 }],
		};
		const published = await run(publishCommunityIcon({ name: "Cache", recipe: clear }));
		expect(published._tag).toBe("Success");
	});

	it("keeps out what moderation rejects and what the owner hid", async () => {
		const database = await nativeDatabase();
		const rejected = await run(publishCommunityIcon({ name: "Box", recipe: BOX }), {
			database,
			allowed: false,
		});
		expect(rejected._tag === "Failure" && rejected.failure._tag).toBe("CommunityIconRejectedError");

		await run(publishCommunityIcon({ name: "Box", recipe: BOX }), { database });
		const hidden = await run(
			Effect.flatMap(CommunityIconStore, (store) => store.setHidden("box", true)),
			{ database },
		);
		expect(hidden._tag === "Success" && hidden.success).toBe(true);
		const again = await run(publishCommunityIcon({ name: "Box", recipe: BOX }), { database });
		expect(again._tag === "Failure" && again.failure._tag).toBe("CommunityIconRejectedError");
	});
});

describe("CommunityIconStore", () => {
	async function seeded() {
		const database = await nativeDatabase();
		const store = await openStore(database);
		for (const [index, name] of ["Kafka topic", "Queue", "Database", "Kafka broker"].entries()) {
			const recipe: IconRecipe = {
				parts: [{ kind: "rect", x: index, y: 4, width: 8, height: 8 }],
			};
			await Effect.runPromise(
				store.insert({ name, recipe, hash: await communityIconHash(recipe) }),
			);
			await database
				.prepare("UPDATE community_icons SET created_at = ? WHERE hash = ?")
				.bind(
					new Date(Date.UTC(2026, 10, 8, 12, 0, index)).toISOString(),
					await communityIconHash(recipe),
				)
				.run();
		}
		return { database, store };
	}

	it("searches newest first by name or slug and pages with a cursor", async () => {
		const { store } = await seeded();
		const all = await Effect.runPromise(store.search({}));
		expect(all.icons.map((icon) => icon.slug)).toEqual([
			"kafka-broker",
			"database",
			"queue",
			"kafka-topic",
		]);
		const kafka = await Effect.runPromise(store.search({ query: "kafka" }));
		expect(kafka.icons.map((icon) => icon.slug)).toEqual(["kafka-broker", "kafka-topic"]);
		expect(
			(await Effect.runPromise(store.search({ query: "kafka-t" }))).icons.map((icon) => icon.slug),
		).toEqual(["kafka-topic"]);
		expect((await Effect.runPromise(store.search({ query: "100%" }))).icons).toEqual([]);

		const first = await Effect.runPromise(store.search({ limit: 3 }));
		expect(first.icons).toHaveLength(3);
		expect(first.nextCursor).toBeDefined();
		const rest = await Effect.runPromise(
			store.search({
				limit: 3,
				...(first.nextCursor ? { ...(first.nextCursor ? { cursor: first.nextCursor } : {}) } : {}),
			}),
		);
		expect(rest.icons.map((icon) => icon.slug)).toEqual(["kafka-topic"]);
		expect(rest.nextCursor).toBeUndefined();
	});

	it("leaves hidden icons out of reads and returns them when restored", async () => {
		const { store } = await seeded();
		await Effect.runPromise(store.setHidden("queue", true));
		expect(await Effect.runPromise(store.get("queue"))).toBeUndefined();
		expect(
			(await Effect.runPromise(store.getMany(["queue", "database", "missing"]))).map(
				(icon) => icon.slug,
			),
		).toEqual(["database"]);
		expect((await Effect.runPromise(store.search({}))).icons).toHaveLength(3);
		expect(await Effect.runPromise(store.setHidden("missing", true))).toBe(false);
		await Effect.runPromise(store.setHidden("queue", false));
		expect((await Effect.runPromise(store.get("queue")))?.name).toBe("Queue");
	});

	it("keeps native D1 hash and slug authority under overlapping writers", async () => {
		const database = await nativeDatabase();
		const a = await openStore(database),
			b = await openStore(database);
		const hash = await communityIconHash(RING);
		const same = await Promise.all([
			Effect.runPromise(a.insert({ name: "Ring", recipe: RING, hash })),
			Effect.runPromise(b.insert({ name: "Other ring", recipe: RING, hash })),
		]);
		expect(same.filter((result) => result.created)).toHaveLength(1);
		expect(new Set(same.map((result) => result.icon.slug)).size).toBe(1);
		const different = await Promise.all([
			Effect.runPromise(a.insert({ name: "Box", recipe: BOX, hash: await communityIconHash(BOX) })),
			Effect.runPromise(b.insert({ name: "Box", recipe: RING, hash: "deliberate-distinct-hash" })),
		]);
		expect(new Set(different.map((result) => result.icon.slug)).size).toBe(2);
	});
	it("pages equal timestamps without gaps and treats LIKE wildcards literally", async () => {
		const { database, store } = await seeded();
		await database
			.prepare("UPDATE community_icons SET created_at='2026-11-08T12:00:00.000Z'")
			.run();
		const first = await Effect.runPromise(store.search({ limit: 2 }));
		const second = await Effect.runPromise(
			store.search({ limit: 2, ...(first.nextCursor ? { cursor: first.nextCursor } : {}) }),
		);
		expect([...first.icons, ...second.icons].map((icon) => icon.slug)).toEqual([
			"queue",
			"kafka-topic",
			"kafka-broker",
			"database",
		]);
		expect((await Effect.runPromise(store.search({ query: "kafka%" }))).icons).toEqual([]);
		expect((await Effect.runPromise(store.search({ query: "kafka_" }))).icons).toEqual([]);
	});

	it("skips rows whose recipe no longer draws", async () => {
		const { database, store } = await seeded();
		await database.prepare("UPDATE community_icons SET recipe = '{}' WHERE slug = 'queue'").run();
		expect(await Effect.runPromise(store.get("queue"))).toBeUndefined();
		expect((await Effect.runPromise(store.search({}))).icons).toHaveLength(3);
	});
});

describe("Workers AI moderation", () => {
	function jev(answer: unknown) {
		const calls: { model: string; input: unknown }[] = [];
		const moderation = workersAiCommunityModeration({
			run: async (model, input) => {
				calls.push({ model, input });
				if (answer instanceof Error) throw answer;
				return answer;
			},
		});
		const review = Effect.result(moderation.review({ name: "Kafka", words: ["K"] }));
		return { calls, review };
	}
	const noul = (value: number) => ({
		model: "jev-1.13.0",
		answers: { unfit: { type: "noul", noul: value } },
		usage: { input_tokens: 120, output_tokens: 4 },
	});

	it("asks Jev one noul question and keeps out what it finds unfit", async () => {
		const fit = jev(noul(0.1));
		expect(await Effect.runPromise(fit.review)).toMatchObject({
			_tag: "Success",
			success: { allowed: true },
		});
		expect(fit.calls).toEqual([
			{
				model: "typesafe/jev",
				input: {
					state: { name: "Kafka", words: ["K"] },
					questions: { unfit: expect.objectContaining({ type: "noul" }) },
				},
			},
		]);
		expect(await Effect.runPromise(jev(noul(0.8)).review)).toMatchObject({
			_tag: "Success",
			success: { allowed: false },
		});
		// The Workers AI binding wraps the answer.
		expect(
			await Effect.runPromise(jev({ state: "Completed", result: noul(0.07) }).review),
		).toMatchObject({ _tag: "Success", success: { allowed: true } });
	});

	it("reports moderation unavailable when Jev fails or answers off-shape", async () => {
		for (const answer of [new Error("AI down"), { answers: {} }, noul(Number.NaN)]) {
			const result = await Effect.runPromise(jev(answer).review);
			expect(result._tag === "Failure" && result.failure._tag).toBe(
				"CommunityIconModerationUnavailableError",
			);
		}
	});
});
