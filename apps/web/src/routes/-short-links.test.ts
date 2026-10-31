import { describe, expect, it, vi } from "vitest";

import {
	CLI_INSTALL_COMMAND,
	CLI_INSTALL_SCRIPT_SOURCE_URL,
	CLI_INSTALL_SCRIPT_URL,
} from "../lib/cli-package";
import { PORTABLE_SKILL_SOURCE_URL, PORTABLE_SKILL_URL } from "../lib/portable-skill";
import { Route as InstallRoute } from "./install[.]sh";
import { Route as SkillRoute } from "./skill[.]md";

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({ options }),
}));

interface RedirectRouteOptions {
	server: { handlers: Record<"GET" | "HEAD", () => Response> };
}

function handlersOf(route: unknown) {
	return (route as { options: RedirectRouteOptions }).options.server.handlers;
}

/**
 * Setup commands use short sketchi.app URLs so each fits one desktop line.
 * Each redirects to the file committed on main, which `curl -fsSL` follows.
 */
describe("short links", () => {
	it.each([
		["/skill.md", SkillRoute, PORTABLE_SKILL_URL, PORTABLE_SKILL_SOURCE_URL],
		["/install.sh", InstallRoute, CLI_INSTALL_SCRIPT_URL, CLI_INSTALL_SCRIPT_SOURCE_URL],
	])("%s redirects GET and HEAD to the file on main", (path, route, shortUrl, sourceUrl) => {
		expect(shortUrl).toBe(`https://sketchi.app${path}`);
		expect(sourceUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/shpitdev\/sketchi\/main\//);

		const { GET, HEAD } = handlersOf(route);
		for (const response of [GET(), HEAD()]) {
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(sourceUrl);
		}
	});

	it("installs the CLI through the short link", () => {
		expect(CLI_INSTALL_COMMAND).toBe("curl -fsSL https://sketchi.app/install.sh | sh");
	});
});
