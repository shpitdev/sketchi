import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import { agentSetupEntries } from "../components/agent-setup-view/agent-setup-data";
import { CLI_INSTALL_SCRIPT_SOURCE_URL, CLI_INSTALL_SCRIPT_URL } from "../lib/cli-package";
import { PORTABLE_SKILL_SOURCE_URL, PORTABLE_SKILL_URL } from "../lib/portable-skill";
import { DEFAULT_WEB_SURFACE_URLS, resolveWebSurfaceUrls } from "../lib/surface-urls";
import { Route as InstallRoute } from "../routes/install[.]sh";
import { Route as SkillRoute } from "../routes/skill[.]md";

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({ options }),
}));

interface RedirectRouteOptions {
	server: { handlers: Record<"GET" | "HEAD", () => Response> };
}

describe("setup commands a person pastes", () => {
	const steps = agentSetupEntries.flatMap((entry) =>
		entry.steps.map((step) => ({ name: entry.name, step })),
	);

	it("parses every shell step as a script, so it runs as pasted", () => {
		const shell = steps.filter(({ step }) => step.kind === "shell");
		expect(shell.length).toBeGreaterThan(0);
		for (const { name, step } of shell) {
			const result = spawnSync("sh", ["-n"], { encoding: "utf8", input: step.value });
			expect(result.status, `${name}: ${step.label}\n${result.stderr}`).toBe(0);
		}
	});

	it("keeps every config step valid JSON", () => {
		const json = steps.filter(({ step }) => step.kind === "json");
		expect(json.length).toBeGreaterThan(0);
		for (const { step } of json) expect(() => JSON.parse(step.value)).not.toThrow();
	});

	it.each([
		[PORTABLE_SKILL_URL, SkillRoute, PORTABLE_SKILL_SOURCE_URL],
		[CLI_INSTALL_SCRIPT_URL, InstallRoute, CLI_INSTALL_SCRIPT_SOURCE_URL],
	])("redirects %s on GET and HEAD to the file on main", (_url, route, source) => {
		expect(source).toMatch(/^https:\/\/raw\.githubusercontent\.com\/shpitdev\/sketchi\/main\//);
		const { GET, HEAD } = (route as unknown as { options: RedirectRouteOptions }).options.server
			.handlers;
		for (const response of [GET(), HEAD()]) {
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(source);
		}
	});
});

describe("surface links", () => {
	it.each([
		"javascript:alert(1)",
		"https://sketchi-playground.dimethyl.workers.dev",
		"https://pr-42-sketchi-playground.dimethyl.workers.dev./",
		"https://sketchi-playground-pr-42.dimethyl.workers.dev",
		"https://pr-42-sketchi-playground.other-account.workers.dev",
	])("never link to %s, falling back to the public URL", (url) => {
		expect(resolveWebSurfaceUrls({ SKETCHI_PLAYGROUND_URL: url }).playground).toBe(
			DEFAULT_WEB_SURFACE_URLS.playground,
		);
	});
});
