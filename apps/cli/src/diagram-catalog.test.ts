import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import type { DiagramListEntry } from "./contracts.js";
import {
	closestIds,
	matchesQuery,
	newestFirst,
	relativeTime,
	resolveDiagramId,
} from "./diagram-catalog.js";
import { CliStorageError, exitCodeForFailure } from "./errors.js";
import { LocalFileSystem } from "./filesystem.js";
import { DiagramStore, DiagramStoreLive, makeStorageRootLayer } from "./storage.js";
import { builtDiagram, canonicalDocument, localFileSystemLive } from "./__tests__/fixtures.js";

const testParent = resolve(process.cwd(), ".memory/cli-catalog-tests");

function summary(id: string, extra: Partial<DiagramListEntry> = {}): DiagramListEntry {
	return {
		id,
		type: "flowchart",
		title: `Title ${id}`,
		revision: 1,
		formats: ["scene", "excalidraw"],
		authority: "canonical",
		documentAuthoritative: true,
		...extra,
	};
}

describe("listing order and search", () => {
	it("puts the newest first, then undated records by id, then unreadable records", () => {
		const ordered = newestFirst([
			{ id: "broken", status: "unavailable", code: "corrupt_record", message: "", hint: "" },
			summary("undated-b"),
			summary("old", { createdAt: "2026-01-01T00:00:00.000Z" }),
			summary("undated-a"),
			summary("legacy", { updatedAt: "2026-06-01T00:00:00.000Z" }),
			summary("new", { createdAt: "2026-11-01T00:00:00.000Z" }),
		]);
		assert.deepStrictEqual(
			ordered.map(({ id }) => id),
			["new", "legacy", "old", "undated-a", "undated-b", "broken"],
		);
	});

	it("prefers createdAt over the last change on disk", () => {
		const ordered = newestFirst([
			summary("edited-old", {
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-11-02T00:00:00.000Z",
			}),
			summary("created-new", { createdAt: "2026-11-01T00:00:00.000Z" }),
		]);
		assert.deepStrictEqual(
			ordered.map(({ id }) => id),
			["created-new", "edited-old"],
		);
	});

	it("matches every word against title, id, and prompt, ignoring case", () => {
		const entry = summary("checkout-flow", {
			title: "Payment path",
			prompt: "Map how a SHOPPER pays at checkout",
		});
		assert.isTrue(matchesQuery(entry, { text: "checkout" }));
		assert.isTrue(matchesQuery(entry, { text: "payment shopper" }));
		assert.isFalse(matchesQuery(entry, { text: "payment refund" }));
		assert.isTrue(matchesQuery(entry, { text: "", type: "flowchart" }));
		assert.isFalse(matchesQuery(entry, { type: "sequence" }));
	});
});

describe("relative time", () => {
	const now = Date.parse("2026-11-05T12:00:00.000Z");
	it("reads naturally from seconds to months", () => {
		assert.strictEqual(relativeTime(now - 10_000, now), "just now");
		assert.strictEqual(relativeTime(now - 5 * 60_000, now), "5m ago");
		assert.strictEqual(relativeTime(now - 3 * 3_600_000, now), "3h ago");
		assert.strictEqual(relativeTime(now - 30 * 3_600_000, now), "yesterday");
		assert.strictEqual(relativeTime(now - 4 * 86_400_000, now), "4d ago");
		assert.strictEqual(relativeTime(Date.parse("2026-03-14T09:00:00.000Z"), now), "2026-03-14");
	});
});

describe("closest ids", () => {
	const ids = ["checkout-flow", "checkout-sequence", "launch-map", "release-flow"];
	it("suggests ids that contain the input or are a few edits away", () => {
		assert.deepStrictEqual(closestIds("relese-flow", ids), ["release-flow"]);
		assert.deepStrictEqual(closestIds("checkout", ids), ["checkout-flow", "checkout-sequence"]);
		assert.deepStrictEqual(closestIds("lanch", ids), ["launch-map"]);
		assert.deepStrictEqual(closestIds("zzzzzz", ids), []);
	});
});

function withStore<A, E>(use: (root: string) => Effect.Effect<A, E, DiagramStore>) {
	return Effect.acquireUseRelease(
		Effect.promise(async () => {
			await mkdir(testParent, { recursive: true });
			return mkdtemp(join(testParent, "store-"));
		}),
		(root) =>
			use(root).pipe(
				Effect.provide(
					Layer.fresh(DiagramStoreLive).pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(LocalFileSystem, localFileSystemLive),
								makeStorageRootLayer(root),
							),
						),
					),
				),
			),
		(root) => Effect.promise(() => rm(root, { force: true, recursive: true })),
	);
}

const create = (id: string, prompt?: string) =>
	Effect.gen(function* () {
		const store = yield* DiagramStore;
		const document = canonicalDocument({
			...canonicalDocument(),
			spec: { ...canonicalDocument().spec, id, title: `Diagram ${id}` },
		});
		return yield* store.create({
			...builtDiagram({ id, document }),
			...(prompt === undefined ? {} : { prompt }),
		});
	});

const failure = <A, E>(effect: Effect.Effect<A, E, DiagramStore>) =>
	effect.pipe(
		Effect.flip,
		Effect.flatMap((error) =>
			error instanceof CliStorageError
				? Effect.succeed(error)
				: Effect.die(new Error(`Expected a storage error, got ${String(error)}`)),
		),
	);

describe("diagram id resolution", () => {
	it.effect("resolves exact ids, latest, and unique prefixes", () =>
		withStore(() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-11-01T00:00:00.000Z"));
				yield* create("release-flow");
				yield* TestClock.adjust("1 hour");
				yield* create("checkout-flow");
				yield* TestClock.adjust("1 hour");
				yield* create("checkout-sequence");
				yield* create("rel");

				assert.strictEqual(yield* resolveDiagramId("release-flow"), "release-flow");
				// An exact id wins over a longer id it prefixes.
				assert.strictEqual(yield* resolveDiagramId("rel"), "rel");
				assert.strictEqual(yield* resolveDiagramId("relea"), "release-flow");
				assert.strictEqual(yield* resolveDiagramId("latest"), "checkout-sequence");
				assert.strictEqual(yield* resolveDiagramId("checkout-s"), "checkout-sequence");

				const ambiguous = yield* failure(resolveDiagramId("checkout"));
				assert.strictEqual(ambiguous.code, "ambiguous_diagram_id");
				assert.include(ambiguous.hint, "checkout-flow, checkout-sequence");
				assert.strictEqual(exitCodeForFailure(ambiguous), 5);

				const unknown = yield* failure(resolveDiagramId("relese-flow"));
				assert.strictEqual(unknown.code, "diagram_not_found");
				assert.strictEqual(unknown.hint, "Did you mean release-flow? Run sketchi list to search.");
			}),
		),
	);

	it.effect("explains that an empty store has no latest diagram", () =>
		withStore(() =>
			Effect.gen(function* () {
				const error = yield* failure(resolveDiagramId("latest"));
				assert.strictEqual(error.code, "diagram_not_found");
				assert.strictEqual(error.hint, "Create one with sketchi generate.");
			}),
		),
	);
});

describe("record provenance", () => {
	it.effect("stores createdAt and the prompt, and keeps them across revisions", () =>
		withStore(() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-11-01T08:30:00.000Z"));
				const created = yield* create("release-flow", "Map release approval");
				assert.strictEqual(created.manifest.createdAt, "2026-11-01T08:30:00.000Z");
				assert.strictEqual(created.manifest.prompt, "Map release approval");

				yield* TestClock.adjust("1 day");
				const store = yield* DiagramStore;
				const edited = yield* store.edit("release-flow", builtDiagram());
				assert.strictEqual(edited.manifest.revision, 2);
				assert.strictEqual(edited.manifest.createdAt, "2026-11-01T08:30:00.000Z");
				assert.strictEqual(edited.manifest.prompt, "Map release approval");

				const restored = yield* store.restore("release-flow", 1);
				assert.strictEqual(restored.diagram.manifest.createdAt, "2026-11-01T08:30:00.000Z");
				assert.strictEqual(restored.diagram.manifest.prompt, "Map release approval");

				const [listed] = yield* store.list();
				assert.strictEqual(listed?.createdAt, "2026-11-01T08:30:00.000Z");
				assert.strictEqual(listed?.prompt, "Map release approval");
				assert.isString(listed?.updatedAt);
			}),
		),
	);

	it.effect("loads, lists, and dates a record written before createdAt existed", () =>
		withStore((root) =>
			Effect.gen(function* () {
				yield* TestClock.setTime(Date.parse("2026-11-01T00:00:00.000Z"));
				yield* create("legacy");
				yield* create("modern");
				const manifestPath = join(root, "legacy", "manifest.json");
				// Rewrite the manifest exactly as earlier CLIs did, without the new keys.
				const manifest: Record<string, unknown> = JSON.parse(
					yield* Effect.promise(() => readFile(manifestPath, "utf8")),
				);
				delete manifest["createdAt"];
				delete manifest["prompt"];
				yield* Effect.promise(() => writeFile(manifestPath, JSON.stringify(manifest)));
				const changed = new Date("2025-05-05T05:05:05.000Z");
				yield* Effect.promise(() => utimes(manifestPath, changed, changed));

				const store = yield* DiagramStore;
				const shown = yield* store.show("legacy");
				assert.isUndefined(shown.manifest.createdAt);
				const listed = yield* store.list();
				const legacy = listed.find(({ id }) => id === "legacy");
				assert.isUndefined(legacy?.createdAt);
				assert.strictEqual(legacy?.updatedAt, "2025-05-05T05:05:05.000Z");
				assert.deepStrictEqual(
					newestFirst(listed).map(({ id }) => id),
					["modern", "legacy"],
				);
				assert.strictEqual(yield* resolveDiagramId("latest"), "modern");
			}),
		),
	);
});
