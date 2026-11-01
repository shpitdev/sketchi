import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { IconManifest, SketchiIcon } from "@sketchi/icon-catalog";
import { IconLibrary } from "./icon-library";

const fixtureData: IconManifest = {
	icons: [
		{
			aliases: [],
			bytes: 1802,
			collection: "ai-apps-agents",
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
		makeIcon(`icon-${String(index).padStart(3, "0")}`, index % 2 ? "odd-set" : "even-set"),
	);
	return {
		icons,
		summary: { collectionCounts: { "even-set": 200, "odd-set": 200 }, totalIcons: icons.length },
		version: 1,
	};
})();

const search = () =>
	screen.getByRole("searchbox", { hidden: true, name: "Search icons" }) as HTMLInputElement;
const selectionBar = () => screen.queryByRole("region", { name: "Selected icons" });
const cardCheckbox = (name: string) =>
	screen.getByRole("checkbox", { name: `Select ${name}` }) as HTMLInputElement;
const resultNames = () =>
	within(screen.getByRole("region", { name: "Icon results" }))
		.getAllByRole("button", { name: /^Copy .* SVG$/ })
		.map((button) => button.getAttribute("aria-label")?.replace(/^Copy (.*) SVG$/, "$1"));

function openCollections() {
	const trigger = screen.getByRole("button", { name: /^Collections:/ });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
	return screen.getByRole("menu");
}

function pressModK(target: Element = document.activeElement ?? document.body) {
	fireEvent.keyDown(target, { ctrlKey: true, key: "k" });
}

/** The palette's own search input, which owns focus while it is open. */
function paletteInput() {
	return within(screen.getByRole("dialog", { name: "Commands" })).getByRole("combobox");
}

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
				Promise.resolve({
					ok: true,
					text: () => Promise.resolve(`<svg data-path="${path}" viewBox="0 0 1 1" />`),
				}),
			),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("keeps the header wordmark on the shared script font", () => {
		const styles = readFileSync(resolve(process.cwd(), "apps/icons/src/styles/app.css"), "utf8");
		const rootRoute = readFileSync(
			resolve(process.cwd(), "apps/icons/src/routes/__root.tsx"),
			"utf8",
		);
		expect(styles).toMatch(
			/\.icons-brand \.sk-wordmark\s*\{[^}]*font-family:\s*var\(--font-script\)/u,
		);
		expect(rootRoute).not.toContain("family=Dancing+Script");
		expect(rootRoute).toContain(
			"/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2",
		);
	});

	it("leads with the heading and search, and names its header marks", () => {
		render(<IconLibrary data={fixtureData} />);
		expect(screen.getByRole("heading", { level: 1, name: "Icons" })).toBeTruthy();
		expect(screen.queryByText(/ready when you are/i)).toBeNull();
		expect(screen.queryByLabelText("Library summary")).toBeNull();
		const header = within(screen.getByRole("banner"));
		expect(header.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
			"https://sketchi.app/docs",
		);
		expect(header.getByRole("link", { name: "Sketchi on GitHub" }).getAttribute("href")).toBe(
			"https://github.com/shpitdev/sketchi",
		);
		// llms.txt is a footer link, not a header competitor.
		const llms = screen.getAllByRole("link", { name: "llms.txt" });
		expect(llms).toHaveLength(1);
		expect(llms[0]?.closest("footer")).toBeTruthy();
		expect(llms[0]?.getAttribute("href")).toBe("/llms.txt");
		expect(screen.getByRole("button", { name: "Commands" })).toBeTruthy();
	});

	it("finds a seeded alias", () => {
		render(<IconLibrary data={fixtureData} />);
		fireEvent.change(search(), { target: { value: "k8s" } });
		expect(resultNames()).toEqual(["Kubernetes"]);
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

	describe("collection filter", () => {
		it("ORs ticked collections and ANDs them with the search", () => {
			render(<IconLibrary data={fixtureData} />);
			const menu = openCollections();
			fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /Data Storage/ }));
			// The menu stays open so several collections can be ticked in one go.
			fireEvent.click(
				within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: /Devtools CI/ }),
			);
			expect(resultNames()).toEqual(["Kubernetes", "PostgreSQL"]);
			expect(screen.getByRole("button", { name: "Collections: 2 collections" })).toBeTruthy();

			fireEvent.change(search(), { target: { value: "psql" } });
			expect(resultNames()).toEqual(["PostgreSQL"]);

			fireEvent.click(
				within(screen.getByRole("menu")).getByRole("menuitemcheckbox", { name: /Data Storage/ }),
			);
			expect(screen.getByRole("heading", { name: "No icons found" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Search all collections" }));
			expect(resultNames()).toEqual(["PostgreSQL"]);
			expect(search().value).toBe("psql");
		});

		it("does not move the grid highlight while the menu owns the arrow keys", () => {
			const { container } = render(<IconLibrary data={fixtureData} />);
			const menu = openCollections();
			fireEvent.keyDown(menu, { key: "ArrowDown" });
			expect(container.querySelector('[data-active="true"]')).toBeNull();
			fireEvent.keyDown(menu, { key: "Escape" });
			expect(screen.queryByRole("menu")).toBeNull();
		});
	});

	describe("selection", () => {
		it("keeps selected icons through search and collection changes and says how many are hidden", () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.click(cardCheckbox("PostgreSQL"));
			expect(selectionBar()?.textContent).toContain("1 selected");

			fireEvent.change(search(), { target: { value: "k8s" } });
			fireEvent.click(cardCheckbox("Kubernetes"));
			expect(selectionBar()?.textContent).toContain("2 selected");
			expect(selectionBar()?.textContent).toContain("1 not shown");

			const menu = openCollections();
			fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /AI Apps Agents/ }));
			expect(screen.getByRole("heading", { name: "No icons found" })).toBeTruthy();
			expect(selectionBar()?.textContent).toContain("2 selected");
			expect(selectionBar()?.textContent).toContain("2 not shown");

			fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
			expect(cardCheckbox("PostgreSQL").checked).toBe(true);
			expect(cardCheckbox("Kubernetes").checked).toBe(true);
			expect(cardCheckbox("Codex").checked).toBe(false);
			expect(selectionBar()?.textContent).not.toContain("not shown");
		});

		it("keeps every toggle when several land in one batch", () => {
			render(<IconLibrary data={fixtureData} />);
			const boxes = screen.getAllByRole("checkbox", { name: /^Select (?!all)/ });
			expect(boxes).toHaveLength(3);
			act(() => {
				for (const box of boxes) box.click();
			});
			expect(selectionBar()?.textContent).toContain("3 selected");
			act(() => {
				for (const box of screen.getAllByRole("checkbox", { name: /^Select (?!all)/ })) box.click();
			});
			expect(selectionBar()).toBeNull();
		});

		it("selects and deselects only the current results with one checkbox", () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.click(cardCheckbox("Codex"));
			fireEvent.change(search(), { target: { value: "psql" } });
			const selectAll = screen.getByRole("checkbox", {
				name: "Select all results",
			}) as HTMLInputElement;
			expect(resultNames()).not.toContain("Codex");
			fireEvent.click(selectAll);
			expect(selectAll.checked).toBe(true);
			expect(selectionBar()?.textContent).toContain(`${1 + resultNames().length} selected`);

			fireEvent.click(selectAll);
			// Codex was outside these results, so it stays selected.
			expect(selectionBar()?.textContent).toContain("1 selected");
			expect(selectionBar()?.textContent).toContain("1 not shown");
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
			expect(Object.keys(files).sort()).toEqual(["kubernetes.svg", "postgresql.svg"]);
			expect(strFromU8(files["postgresql.svg"] as Uint8Array)).toContain("/icons/postgresql.svg");
			expect(await screen.findByText("Downloaded 2 SVGs as a zip.")).toBeTruthy();
		});

		it("reports a failed export and keeps the selection", async () => {
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
			render(<IconLibrary data={fixtureData} />);
			fireEvent.click(cardCheckbox("Codex"));
			fireEvent.click(screen.getByRole("button", { name: "Copy SVGs" }));
			expect(
				await screen.findByText("Could not prepare the selected icons. Try again."),
			).toBeTruthy();
			expect(selectionBar()?.textContent).toContain("1 selected");
		});
	});

	describe("keyboard", () => {
		it("focuses search with slash and copies the keyboard result with Enter", async () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.keyDown(document, { key: "/" });
			expect(document.activeElement).toBe(search());
			fireEvent.change(search(), { target: { value: "psql" } });
			fireEvent.keyDown(search(), { key: "Enter" });
			await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		});

		it("focuses search from layouts where slash is a shifted key", () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.keyDown(document, { code: "Digit7", key: "/", shiftKey: true });
			expect(document.activeElement).toBe(search());
		});

		it("starts with no active card and only highlights once the user navigates", () => {
			const { container } = render(<IconLibrary data={fixtureData} />);
			const activeCards = () => container.querySelectorAll('[data-active="true"]');
			expect(activeCards()).toHaveLength(0);
			fireEvent.keyDown(document, { key: "ArrowDown" });
			expect(activeCards()[0]?.textContent).toContain("Codex");
			fireEvent.keyDown(document, { key: "ArrowDown" });
			expect(activeCards()[0]?.textContent).toContain("Kubernetes");
			fireEvent.keyDown(document, { key: "Escape" });
			expect(activeCards()).toHaveLength(0);
		});

		it("leaves the selection checkboxes' own keys alone", () => {
			const { container } = render(<IconLibrary data={fixtureData} />);
			const box = cardCheckbox("Codex");
			box.focus();
			expect(fireEvent.keyDown(box, { key: "ArrowDown" })).toBe(true);
			expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true);
			expect(container.querySelector('[data-active="true"]')).toBeNull();
			expect(writeText).not.toHaveBeenCalled();
		});

		it("clears the selection by shortcut, from the search field too", () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.keyDown(document, { ctrlKey: true, key: "a" });
			expect(selectionBar()?.textContent).toContain("3 selected");
			search().focus();
			// Mod+A keeps its native meaning inside the field.
			expect(fireEvent.keyDown(search(), { ctrlKey: true, key: "a" })).toBe(true);
			fireEvent.keyDown(search(), { ctrlKey: true, key: "d" });
			expect(selectionBar()).toBeNull();
			expect(screen.getByText("Selection cleared.")).toBeTruthy();
		});

		it("keeps Mod+A and Mod+D working right after ticking a checkbox", () => {
			render(<IconLibrary data={fixtureData} />);
			const box = cardCheckbox("Codex");
			box.focus();
			fireEvent.click(box);
			expect(document.activeElement).toBe(box);

			expect(fireEvent.keyDown(box, { ctrlKey: true, key: "a" })).toBe(false);
			expect(selectionBar()?.textContent).toContain("3 selected");
			expect(fireEvent.keyDown(box, { ctrlKey: true, key: "d" })).toBe(false);
			expect(selectionBar()).toBeNull();
		});

		it("leaves the browser's own shortcuts alone when it has nothing to do", () => {
			const { unmount } = render(<IconLibrary data={fixtureData} initialQuery="missing" />);
			expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(true);
			expect(fireEvent.keyDown(document, { ctrlKey: true, key: "d" })).toBe(true);
			expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
			expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
			unmount();

			render(<IconLibrary data={fixtureData} />);
			expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(false);
			expect(fireEvent.keyDown(document, { ctrlKey: true, key: "a" })).toBe(true);
		});
	});

	describe("command palette", () => {
		it("opens from the search field and Escape closes it without clearing anything", async () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.click(cardCheckbox("Codex"));
			search().focus();
			fireEvent.change(search(), { target: { value: "postgres" } });
			search().setSelectionRange(2, 5);

			pressModK(search());
			expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
			expect(document.activeElement).toBe(paletteInput());

			// The real sequence: Radix dismisses on Escape and React re-renders
			// before the same event reaches the grid's Escape shortcut.
			fireEvent.keyDown(paletteInput(), { key: "Escape" });
			expect(screen.queryByRole("dialog")).toBeNull();
			expect(search().value).toBe("postgres");
			// Radix hands focus back on a timer once the dialog unmounts.
			await waitFor(() => expect(document.activeElement).toBe(search()));
			expect([search().selectionStart, search().selectionEnd]).toEqual([2, 5]);
			expect(selectionBar()?.textContent).toContain("1 selected");

			// A second Escape is the grid's again.
			fireEvent.keyDown(search(), { key: "Escape" });
			expect(search().value).toBe("");
		});

		it("keeps grid shortcuts out of the palette", () => {
			const { container } = render(<IconLibrary data={fixtureData} />);
			pressModK(document.body);
			const input = paletteInput();
			fireEvent.keyDown(input, { key: "ArrowDown" });
			fireEvent.keyDown(input, { key: "/" });
			fireEvent.keyDown(input, { ctrlKey: true, key: "a" });
			expect(container.querySelector('[data-active="true"]')).toBeNull();
			expect(document.activeElement).toBe(input);
			expect(selectionBar()).toBeNull();
			// Mod+K toggles it closed again.
			pressModK(input);
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		it("returns focus to the header button that opened it", async () => {
			render(<IconLibrary data={fixtureData} />);
			const trigger = screen.getByRole("button", { name: "Commands" });
			trigger.focus();
			fireEvent.click(trigger);
			fireEvent.keyDown(paletteInput(), { key: "Escape" });
			await waitFor(() => expect(document.activeElement).toBe(trigger));
		});

		it("runs commands, and only Search moves focus", async () => {
			render(<IconLibrary data={fixtureData} />);
			fireEvent.click(cardCheckbox("Codex"));
			const trigger = screen.getByRole("button", { name: "Commands" });
			trigger.focus();
			fireEvent.click(trigger);
			const dialog = screen.getByRole("dialog", { name: "Commands" });
			expect(within(dialog).getByText("Ctrl+D")).toBeTruthy();
			fireEvent.click(within(dialog).getByRole("option", { name: /Clear selection/ }));
			expect(screen.queryByRole("dialog")).toBeNull();
			await waitFor(() => expect(selectionBar()).toBeNull());
			expect(document.activeElement).toBe(trigger);
			expect(screen.getByText("Selection cleared.")).toBeTruthy();

			fireEvent.click(trigger);
			fireEvent.click(
				within(screen.getByRole("dialog")).getByRole("option", { name: /Search icons/ }),
			);
			await waitFor(() => expect(document.activeElement).toBe(search()));
		});

		it("filters by collection from the palette", async () => {
			render(<IconLibrary data={fixtureData} />);
			pressModK(document.body);
			fireEvent.click(
				within(screen.getByRole("dialog")).getByRole("option", { name: /Devtools CI/ }),
			);
			await waitFor(() => expect(resultNames()).toEqual(["Kubernetes"]));
			expect(screen.getByRole("button", { name: "Collections: Devtools CI" })).toBeTruthy();
		});
	});

	it("keeps background shortcuts inert while details are open and restores focus", () => {
		render(<IconLibrary data={fixtureData} initialQuery="psql" />);
		const opener = screen.getByRole("button", { name: "View PostgreSQL details" });
		opener.focus();
		fireEvent.click(opener);

		expect(search().closest("main")?.hasAttribute("inert")).toBe(true);
		fireEvent.keyDown(document, { key: "/" });
		expect(document.activeElement).not.toBe(search());
		pressModK(document.body);
		expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(opener);
		expect(search().value).toBe("psql");
	});

	it("shows the Command glyph and names the Mac shortcut in its tooltip after hydration", async () => {
		const html = renderToString(<IconLibrary data={fixtureData} />);
		const platform = Object.getOwnPropertyDescriptor(navigator, "platform");
		Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
		const container = document.createElement("div");
		container.innerHTML = html;
		document.body.append(container);
		const recoverableErrors = vi.fn();
		try {
			const trigger = container.querySelector<HTMLButtonElement>(".icons-command-trigger");
			expect(trigger?.getAttribute("aria-label")).toBe("Commands");
			expect(trigger?.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
			expect(trigger?.querySelector("svg.icons-command-trigger__icon")).not.toBeNull();
			expect(trigger?.textContent).toBe("");
			const root = await act(async () =>
				hydrateRoot(container, <IconLibrary data={fixtureData} />, {
					onRecoverableError: recoverableErrors,
				}),
			);
			expect(recoverableErrors).not.toHaveBeenCalled();
			act(() => trigger?.focus());
			const tooltip = await screen.findByRole("tooltip");
			expect(tooltip.textContent).toContain("⌘K");
			act(() => root.unmount());
		} finally {
			container.remove();
			if (platform) Object.defineProperty(navigator, "platform", platform);
			else Reflect.deleteProperty(navigator, "platform");
		}
	});

	it("switches every preview between light and dark", () => {
		const { container } = render(<IconLibrary data={fixtureData} />);
		fireEvent.click(screen.getByRole("button", { name: "Dark preview" }));
		expect(screen.getByRole("button", { name: "Dark preview" }).getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(container.querySelectorAll('[data-preview="dark"]')).toHaveLength(3);
	});

	it("renders accessible loading, error, and empty states", () => {
		const { rerender } = render(<IconLibrary status="loading" />);
		expect(screen.getByLabelText("Loading icons")).toBeTruthy();
		rerender(
			<IconLibrary errorMessage="Connection failed." onRetry={() => undefined} status="error" />,
		);
		expect(screen.getByRole("alert").textContent).toContain("Connection failed.");
		rerender(<IconLibrary data={fixtureData} initialQuery="missing" key="empty" />);
		expect(screen.getByRole("heading", { name: "No icons found" })).toBeTruthy();
	});
});
