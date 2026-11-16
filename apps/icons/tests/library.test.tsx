import { String as Str, Record as Rec } from "effect";
import { render } from "./support/render";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { IconManifest, SketchiIcon } from "@sketchi/icon-catalog";
import { IconLibrary } from "../src/features/catalog/icon-library";

const fixtureData: IconManifest = {
	icons: [
		{
			aliases: [],
			bytes: 1802,
			collection: "ai-apps-agents",
			colorMode: "multicolor",
			keywords: ["ai", "agents"],
			name: "Codex",
			slug: "codex",
			svgPath: "/icons/codex.svg",
			viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		},
		{
			aliases: ["k8s"],
			bytes: 1901,
			collection: "devtools-ci",
			colorMode: "multicolor",
			keywords: ["containers"],
			name: "Kubernetes",
			slug: "kubernetes",
			svgPath: "/icons/kubernetes.svg",
			viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		},
		{
			aliases: ["psql", "postgres"],
			bytes: 901,
			collection: "data-storage",
			colorMode: "multicolor",
			keywords: ["database"],
			name: "PostgreSQL",
			slug: "postgresql",
			svgPath: "/icons/postgresql.svg",
			viewBox: { height: 512, minX: 0, minY: 0, width: 512 },
		},
	],
	summary: {
		collectionCounts: {
			"ai-apps-agents": 1,
			"data-storage": 1,
			"devtools-ci": 1,
		},
		totalIcons: 3,
	},
	version: 1,
};

function makeIcon(slug: string, collection: string, aliases: string[] = []): SketchiIcon {
	return {
		aliases,
		bytes: 100,
		collection,
		colorMode: "multicolor",
		keywords: [],
		name: slug,
		slug,
		svgPath: `/icons/${slug}.svg`,
		viewBox: { height: 1, minX: 0, minY: 0, width: 1 },
	};
}

/** Bigger than the selection cap, spread over two collections. */
const largeData: IconManifest = (() => {
	const icons = Array.from({ length: 400 }, (_, index) =>
		makeIcon(`icon-${Str.padStart(3, "0")(String(index))}`, index % 2 ? "odd-set" : "even-set"),
	);
	return {
		icons,
		summary: { collectionCounts: { "even-set": 200, "odd-set": 200 }, totalIcons: icons.length },
		version: 1,
	};
})();

const search = () =>
	screen.getByRole<HTMLInputElement>("searchbox", { hidden: true, name: "Search icons" });
const selectionBar = () => screen.queryByRole("region", { name: "Selected icons" });
const cardCheckbox = (name: string) =>
	screen.getByRole<HTMLInputElement>("checkbox", { name: `Select ${name}` });
describe("IconLibrary", () => {
	const writeText = vi.fn().mockResolvedValue(undefined);

	beforeAll(() => {
		// Radix and cmdk measure and scroll elements jsdom does not lay out.
		globalThis.ResizeObserver ??= class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
		if (!("scrollIntoView" in Element.prototype)) {
			Object.defineProperty(Element.prototype, "scrollIntoView", {
				configurable: true,
				value: () => undefined,
			});
		}
	});

	beforeEach(() => {
		writeText.mockClear();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn((path: string) =>
				Promise.resolve(
					new Response(`<svg data-path="${new URL(path).pathname}" viewBox="0 0 1 1" />`),
				),
			),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("copies raw SVG with one tile click and confirms it", async () => {
		render(<IconLibrary data={fixtureData} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy Codex SVG" }));
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith(
				'<svg data-path="/icons/codex.svg" viewBox="0 0 1 1" />',
			);
		});
		expect(screen.getByText("Codex SVG copied.")).toBeTruthy();
	});

	it("hides select-results on the whole library and states the cap once filtered", () => {
		render(<IconLibrary data={largeData} />);
		expect(screen.queryByRole("checkbox", { name: /results$/ })).toBeNull();
		// Mod+A is the browser's again while there is nothing narrowed to select.
		expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(true);

		fireEvent.change(search(), { target: { value: "icon" } });
		const selectAll = screen.getByRole("checkbox", { name: "Select 300 of 400 results" });
		expect(selectAll.parentElement?.textContent).toBe("Select 300");
		fireEvent.click(selectAll);
		expect(selectionBar()?.textContent).toContain("300 selected");
		expect(selectionBar()?.textContent).toContain("Limit 300");
		expect(screen.getByText("Selected 300, 100 left out at the 300 icon cap.")).toBeTruthy();
		expect(
			screen.getByRole("checkbox", { name: "Select all results" }).hasAttribute("disabled"),
		).toBe(true);
	});

	// @effect-diagnostics-next-line asyncFunction:off -- React act, hydration and Testing Library await native DOM callbacks at the test host.
	it("downloads exactly the selection, including icons the filter hides", async () => {
		let zipped: Blob | undefined;
		vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
			zipped = blob as Blob;
			return "blob:zip";
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

		render(<IconLibrary data={fixtureData} />);
		fireEvent.click(cardCheckbox("PostgreSQL"));
		fireEvent.change(search(), { target: { value: "k8s" } });
		fireEvent.click(cardCheckbox("Kubernetes"));
		fireEvent.click(screen.getByRole("button", { name: "Download zip" }));

		await waitFor(() => expect(zipped).toBeDefined());
		const files = unzipSync(new Uint8Array(await (zipped as Blob).arrayBuffer()));
		expect(Rec.keys<string, Uint8Array>(files).sort()).toEqual([
			"kubernetes.svg",
			"postgresql.svg",
		]);
		expect(strFromU8(files["postgresql.svg"] as Uint8Array)).toContain("/icons/postgresql.svg");
		expect(await screen.findByText("Downloaded 2 SVGs as a zip.")).toBeTruthy();
	});
});
