import { describe, expect, it } from "vitest";

import { ICON_PACKS } from "./packs.js";
import {
	COMMUNITY_DESCRIPTION,
	packDescription,
	packImage,
	pageMeta,
	SITE_DESCRIPTION,
	SITE_IMAGE,
} from "./site-meta.js";

function content(meta: ReturnType<typeof pageMeta>, key: string): string | undefined {
	const tag = meta.find(
		(entry) => ("property" in entry ? entry.property : "name" in entry ? entry.name : "") === key,
	);
	return tag && "content" in tag ? tag.content : undefined;
}

describe("link previews", () => {
	it("keeps every description short enough for a search result or a card", () => {
		const descriptions = [
			SITE_DESCRIPTION,
			COMMUNITY_DESCRIPTION,
			...ICON_PACKS.map((pack) => packDescription({ id: pack.id, count: 999 })),
		];
		for (const description of descriptions) expect(description.length).toBeLessThanOrEqual(155);
	});

	it("leads a pack's description with its count and its listing's own words", () => {
		expect(packDescription({ id: "palantir", count: 93 })).toBe(
			"93 hand-drawn icons for Palantir's platforms and Foundry applications, such as Ontology, Workshop, Pipeline Builder, Quiver and AIP.",
		);
		expect(packDescription({ id: "all", count: 1172 })).toBe(
			"All 1,172 hand-drawn icons and logos on Sketchi Icons, as one Excalidraw library to download.",
		);
	});

	it("points crawlers at absolute card URLs on the production host", () => {
		const site = pageMeta({ title: "t", description: "d", path: "/", image: SITE_IMAGE });
		expect(content(site, "og:image")).toBe("https://icons.sketchi.app/card.png");
		expect(content(site, "twitter:card")).toBe("summary_large_image");

		const pack = pageMeta({
			title: "Palantir · Sketchi Icons",
			description: "d",
			path: "/packs/palantir",
			image: packImage({ id: "palantir", name: "Palantir" }),
		});
		expect(content(pack, "og:image")).toBe("https://icons.sketchi.app/packs/palantir.card.png");
		expect(content(pack, "og:url")).toBe("https://icons.sketchi.app/packs/palantir");
	});
});
