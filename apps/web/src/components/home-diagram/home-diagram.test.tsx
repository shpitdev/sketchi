import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeDiagram } from "./home-diagram";
import { HOME_DIAGRAM } from "./home-diagram-data";

const editor = vi.hoisted(() => ({ mounts: 0 }));

// diagram-ui's loader sets Excalidraw's asset path and imports it; this stands in for both.
vi.mock("@sketchi/diagram-ui", () => ({
	createFoldedRouteRelease: () => () => undefined,
	loadExcalidraw: () => {
		return Promise.resolve({
			mutateElement: () => undefined,
			Excalidraw: ({
				initialData,
			}: {
				initialData: {
					appState: { scrollX: number; scrollY: number; zoom: { value: number } };
					elements: unknown[];
				};
			}) => {
				editor.mounts += 1;
				const { scrollX, scrollY, zoom } = initialData.appState;
				return (
					<div data-testid="editor" data-camera={`${scrollX} ${scrollY} ${zoom.value}`}>
						{initialData.elements.length} elements
					</div>
				);
			},
		});
	},
}));

const media = (file: string) =>
	readFileSync(resolve(process.cwd(), "apps/web/public/media", file), "utf8");

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("HomeDiagram", () => {
	it("shows Excalidraw's export of the scene under the prompt that made it", () => {
		render(<HomeDiagram />);

		const image = screen.getByRole("img", { name: HOME_DIAGRAM.alt });
		expect(image.getAttribute("src")).toBe(HOME_DIAGRAM.image);
		// The size is fixed before the image loads, so nothing moves when it does.
		expect(image.getAttribute("width")).toBe(String(HOME_DIAGRAM.width));
		expect(image.getAttribute("height")).toBe(String(HOME_DIAGRAM.height));
		expect(screen.getByRole("figure").querySelector("figcaption")?.textContent).toContain(
			HOME_DIAGRAM.prompt,
		);
		expect(screen.queryByTestId("editor")).toBeNull();
	});

	/** An <img> cannot load fonts, so the export must carry its own Excalifont. */
	it("ships the export Excalidraw made, at the size the page reserves, with its font", () => {
		const svg = media("home-diagram.svg");

		expect(svg).toContain("<!-- svg-source:excalidraw -->");
		expect(svg).toContain(`width="${HOME_DIAGRAM.width}"`);
		expect(svg).toContain(`height="${HOME_DIAGRAM.height}"`);
		expect(svg).toMatch(/@font-face \{ font-family: Excalifont; src: url\(data:font\/woff2;/);
	});

	it("keeps the scene Sketchi returned beside it", () => {
		const scene = JSON.parse(media("home-diagram.excalidraw")) as {
			type: string;
			elements: { type: string; text?: string }[];
			files: Record<string, unknown>;
		};

		expect(scene.type).toBe("excalidraw");
		const labels = scene.elements.flatMap((element) => (element.text ? [element.text] : []));
		for (const product of [
			"Next.js",
			"GitHub",
			"Vercel",
			"Cloudflare Workers",
			"PostgreSQL",
			"Redis",
		]) {
			expect(labels.some((label) => label.includes(product))).toBe(true);
		}
	});

	it("says so when the editor cannot load, and Edit tries again", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve(new Response("", { status: 503 }))),
		);
		render(<HomeDiagram />);

		fireEvent.click(screen.getByRole("button", { name: "Edit diagram" }));

		expect((await screen.findByRole("alert")).textContent).toMatch(/didn.t load/);
		expect(screen.getByRole("button", { name: "Edit diagram" })).toHaveProperty("disabled", false);
		expect(screen.queryByTestId("editor")).toBeNull();
	});

	it("swaps in Excalidraw on the same scene, and Reset starts it over", async () => {
		const scene = JSON.parse(media("home-diagram.excalidraw")) as { elements: unknown[] };
		const fetch = vi.fn(() => Promise.resolve(Response.json(scene)));
		vi.stubGlobal("fetch", fetch);
		render(<HomeDiagram />);

		const button = screen.getByRole("button", { name: "Edit diagram" });
		button.focus();
		fireEvent.click(button);

		const canvas = await screen.findByTestId("editor");
		// The same button becomes Reset, so a keyboard user is not dropped back to the page.
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset diagram" }));
		expect(fetch).toHaveBeenCalledWith(HOME_DIAGRAM.scene);
		expect(canvas.textContent).toBe(`${scene.elements.length} elements`);
		// The export's top-left corner at the canvas corner, at the image's zoom (jsdom lays
		// nothing out, so the width falls back to the export's own, zoom 1).
		expect(canvas.dataset.camera).toBe(`${-HOME_DIAGRAM.origin.x} ${-HOME_DIAGRAM.origin.y} 1`);
		// The image stays underneath until the canvas covers it, hidden from screen readers.
		expect(screen.queryByRole("img", { name: HOME_DIAGRAM.alt })).toBeNull();

		const mounts = editor.mounts;
		fireEvent.click(screen.getByRole("button", { name: "Reset diagram" }));
		expect(editor.mounts).toBe(mounts + 1);
		expect(screen.queryByRole("button", { name: "Edit diagram" })).toBeNull();
	});
});
