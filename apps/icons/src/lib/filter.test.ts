import { describe, expect, it } from "vitest";

import type { SketchiIcon } from "@sketchi/icon-catalog";
import { filterIcons, toggleCollection } from "./filter";

function icon(slug: string, collection: string, aliases: string[] = []): SketchiIcon {
	return {
		aliases,
		bytes: 100,
		collection,
		keywords: [],
		name: slug,
		slug,
		svgPath: `/icons/${slug}.svg`,
		viewBox: { height: 1, minX: 0, minY: 0, width: 1 },
	};
}

const icons = [
	icon("postgresql", "data-storage", ["psql", "postgres"]),
	icon("redis", "data-storage"),
	icon("kubernetes", "devtools-ci", ["k8s"]),
	icon("postman", "developer-clients"),
	icon("codex", "ai-apps-agents"),
];

const slugs = (result: readonly SketchiIcon[]) => result.map((entry) => entry.slug).sort();

describe("filterIcons", () => {
	it("returns everything with no query and no collections", () => {
		expect(filterIcons(icons, { collections: new Set(), query: "" })).toHaveLength(icons.length);
	});

	it("ORs the chosen collections", () => {
		const result = filterIcons(icons, {
			collections: new Set(["data-storage", "devtools-ci"]),
			query: "",
		});
		expect(slugs(result)).toEqual(["kubernetes", "postgresql", "redis"]);
	});

	it("ANDs the query with the collection set", () => {
		expect(
			slugs(filterIcons(icons, { collections: new Set(["data-storage"]), query: "post" })),
		).toEqual(["postgresql"]);
		expect(
			slugs(
				filterIcons(icons, {
					collections: new Set(["data-storage", "developer-clients"]),
					query: "post",
				}),
			),
		).toEqual(["postgresql", "postman"]);
	});

	it("matches aliases inside the chosen collections only", () => {
		expect(
			slugs(filterIcons(icons, { collections: new Set(["devtools-ci"]), query: "k8s" })),
		).toEqual(["kubernetes"]);
		expect(filterIcons(icons, { collections: new Set(["data-storage"]), query: "k8s" })).toEqual(
			[],
		);
	});
});

describe("toggleCollection", () => {
	it("adds and removes without mutating the input", () => {
		const start = new Set(["a"]);
		const added = toggleCollection(start, "b");
		expect([...added].sort()).toEqual(["a", "b"]);
		expect([...toggleCollection(added, "a")]).toEqual(["b"]);
		expect([...start]).toEqual(["a"]);
	});
});
