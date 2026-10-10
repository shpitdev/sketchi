import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Route as AgentsDefinition } from "./agents";
import { Route as AntigravityDefinition } from "./agents/antigravity";

const AgentsRoute = AgentsDefinition.options.component;
const AntigravityRoute = AntigravityDefinition.options.component;
if (!AgentsRoute || !AntigravityRoute) throw new Error("Missing agent route component.");

const previewSurfaceUrls = vi.hoisted(() => ({
	icons: "https://pr-456-sketchi-icons.dimethyl.workers.dev",
	playground: "https://pr-456-sketchi-studio.dimethyl.workers.dev",
}));

const routeState = vi.hoisted(() => ({ pathname: "/agents" }));
vi.mock("../lib/surface-urls-rpc", () => ({ getWebSurfaceUrls: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useLoaderData: () => previewSurfaceUrls,
	}),
	useRouterState: () => routeState.pathname,
	Outlet: () => <AntigravityRoute />,
}));
beforeEach(() => {
	routeState.pathname = "/agents";
});

describe("AgentsRoute", () => {
	it("uses configured preview surface URLs in shared chrome", () => {
		render(<AgentsRoute />);

		expect(
			screen.getAllByRole("link", { name: "Icons" }).map((link) => link.getAttribute("href")),
		).toContain(previewSurfaceUrls.icons);
		expect(
			screen.getAllByRole("link", { name: "Playground" }).map((link) => link.getAttribute("href")),
		).toEqual([previewSurfaceUrls.playground, previewSurfaceUrls.playground]);
		expect(
			screen
				.getAllByRole("link", { name: "Agents" })
				.some((link) => link.getAttribute("aria-current") === "page"),
		).toBe(true);
	});
});

describe("Agent detail route", () => {
	it("renders an agent-specific route inside shared chrome", () => {
		routeState.pathname = "/agents/antigravity";
		render(<AgentsRoute />);

		expect(screen.getByRole("heading", { name: "Antigravity", level: 1 })).toBeTruthy();
		expect(
			screen.getByText(/curl -fsSL .*\.agents\/skills\/sketchi-code-mode\/SKILL\.md/),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", {
				name: "Save or merge .agents/mcp_config.json",
				level: 2,
			}),
		).toBeTruthy();
		expect(screen.getByText(/merging the sketchi-code-mode server/)).toBeTruthy();
		expect(
			screen
				.getAllByRole("link", { name: "Agents" })
				.some((link) => link.getAttribute("aria-current") === "page"),
		).toBe(true);
	});
});
