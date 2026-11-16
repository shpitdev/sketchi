// The build plugins the Worker apps load from tools/ops/src/vite, and the font files and cache
// headers they ship.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { clientServerBoundary } from "../src/vite/client-server-boundary";
import {
	excalidrawFontFiles,
	excalidrawFontHeaders,
	excalidrawFonts,
	excalidrawFontsDirectory,
} from "../src/vite/excalidraw-fonts";
import { workerProjectConfig, workerProjectIds } from "../src/workers";
import { repoRoot, scratch } from "./harness";

type Hook = (this: unknown, ...args: unknown[]) => unknown;
const hook = (value: unknown) => value as Hook;

/** Runs the boundary plugin over one client chunk holding these module ids; returns its error. */
function clientBuildError(moduleIds: string[]) {
	const plugin = clientServerBoundary("playground");
	const bundle = {
		"client.js": { type: "chunk", modules: Object.fromEntries(moduleIds.map((id) => [id, {}])) },
	};
	try {
		hook(plugin.generateBundle).call(
			{
				error: (message: string) => {
					throw new Error(message);
				},
			},
			{},
			bundle,
		);
		return undefined;
	} catch (error) {
		return (error as Error).message;
	}
}

// Regression: after apps/playground moved to apps/studio, a hard-coded feature-path pattern
// stopped matching and feature server modules could reach the client bundle unnoticed.
test("Studio client builds reject its server and feature server modules", () => {
	const root = "/repo/apps/studio/src";
	for (const leaked of [
		`${root}/server/runtime.server.ts`,
		`${root}/features/chat/model.server.ts`,
		`${root}/features/mcp/mcp-docs.server.ts?worker`,
		"C:\\repo\\apps\\studio\\src\\features\\build\\http.server.ts",
	]) {
		expect(clientBuildError([`${root}/routes/index.tsx`, leaked])).toMatch(/server modules/);
	}
	expect(
		clientBuildError([
			`${root}/routes/index.tsx`,
			`${root}/features/chat/chat-client.ts`,
			"/repo/packages/diagrams/src/build/index.ts",
		]),
	).toBeUndefined();
});

describe("Excalidraw fonts", () => {
	test("emits the installed fonts into the client build except files public already ships", () => {
		const publicDir = scratch("ops-fonts-");
		const [shipped = "", ...emitted] = excalidrawFontFiles();
		mkdirSync(join(publicDir, "fonts", shipped.split("/")[0] ?? ""), { recursive: true });
		writeFileSync(join(publicDir, "fonts", shipped), "");
		const plugin = excalidrawFonts();
		hook(plugin.configResolved).call(undefined, { publicDir });
		const files: string[] = [];
		hook(plugin.generateBundle).call({
			emitFile: (file: { fileName: string }) => files.push(file.fileName),
		});
		expect(files).toEqual(emitted.map((file) => `fonts/${file}`));
		expect(hook(plugin.applyToEnvironment).call(undefined, { name: "client" })).toBe(true);
		expect(hook(plugin.applyToEnvironment).call(undefined, { name: "ssr" })).toBe(false);
	});

	test("vendored Excalifont subsets are the package's own files", () => {
		const vendored = join(repoRoot, "packages/editor/public/fonts/Excalifont");
		for (const file of excalidrawFontFiles().filter((name) => name.startsWith("Excalifont/"))) {
			expect(readFileSync(join(vendored, file.slice("Excalifont/".length))), file).toEqual(
				readFileSync(join(excalidrawFontsDirectory(), file)),
			);
		}
	});

	test("every Worker app that depends on Excalidraw caches the installed fonts as generated", () => {
		const manifests = execFileSync("git", ["ls-files", "--", "package.json", "**/package.json"], {
			cwd: repoRoot,
			encoding: "utf8",
		})
			.split("\n")
			.filter(Boolean)
			.map((path) => ({ path, manifest: JSON.parse(readFileSync(join(repoRoot, path), "utf8")) }));
		const runtime = new Map(
			manifests.map(({ manifest }) => [
				manifest.name as string,
				Object.keys(manifest.dependencies ?? {}),
			]),
		);
		const renderers = new Set(["@excalidraw/excalidraw", "@sketchi/editor"]);
		const surfaces = workerProjectIds.filter((id) => {
			const root = workerProjectConfig(id).projectRoot;
			const manifest =
				manifests.find(({ path }) => path === `${root}/package.json`)?.manifest ?? {};
			return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).some(
				(name) =>
					renderers.has(name) || (runtime.get(name) ?? []).some((nested) => renderers.has(nested)),
			);
		});
		expect(surfaces.sort()).toEqual(["excalidraw", "playground", "web"]);
		for (const id of surfaces) {
			const headers = readFileSync(
				join(repoRoot, workerProjectConfig(id).projectRoot, "public/_headers"),
				"utf8",
			);
			expect(headers, id).toContain(excalidrawFontHeaders());
		}
	});
});
