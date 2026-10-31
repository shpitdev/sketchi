import { spawnSync } from "node:child_process";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { agentSetupEntries } from "./agent-setup-data";
import { AgentSetupView } from "./agent-setup-view";

describe("AgentSetupView", () => {
	it("renders a hub with one card per agent: name, install type, and a setup link", () => {
		render(<AgentSetupView />);

		expect(
			screen.getByRole("heading", { name: "Add Sketchi to your agent", level: 1 }),
		).toBeTruthy();
		const codex = screen.getByRole("link", { name: /Codex/ });
		expect(codex).toHaveProperty("href", "http://localhost:3000/agents/codex");
		expect(codex.textContent).toBe("CodexPluginSet up →");
		expect(screen.getByRole("link", { name: /OpenCode/ }).textContent).toBe("OpenCodeMCPSet up →");
		expect(screen.getByLabelText("MCP server URL").textContent).toBe(
			"https://playground.sketchi.app/mcp",
		);
		expect(screen.queryByRole("link", { name: /Eval harness/ })).toBeNull();
		expect(screen.queryByRole("link", { name: /Excalidraw app/ })).toBeNull();
	});

	it("renders the OpenCode portable skill and server setup", () => {
		render(<AgentSetupView agentId="opencode" />);

		expect(screen.getByRole("heading", { name: "OpenCode", level: 1 })).toBeTruthy();
		expect(screen.getByLabelText("Connect the server").textContent).toBe(
			"opencode mcp add sketchi-code-mode \\\n  --url https://playground.sketchi.app/mcp",
		);
		expect(screen.getByText(/opencode\/skills\/sketchi-code-mode/)).toBeTruthy();
		expect(screen.getByText("No account or API key needed.")).toBeTruthy();
		expect(screen.queryByText("Good to know")).toBeNull();
	});

	it("renders the Codex plugin marketplace commands", () => {
		render(<AgentSetupView agentId="codex" />);

		expect(screen.getByText("codex plugin marketplace add shpitdev/sketchi")).toBeTruthy();
		expect(
			screen.getByText("codex plugin add sketchi-code-mode-codex@sketchi-agent-plugins"),
		).toBeTruthy();
		expect(screen.getByText("codex mcp get sketchi-code-mode")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: /^Copy / })).toHaveLength(4);
	});

	it("names the Antigravity MCP config path and asks for a merge", () => {
		render(<AgentSetupView agentId="antigravity" />);

		expect(
			screen.getByRole("heading", { name: "Merge into .agents/mcp_config.json" }),
		).toBeTruthy();
	});
});

describe("agent setup commands", () => {
	const shellSteps = agentSetupEntries.flatMap((entry) =>
		entry.steps.filter((step) => step.kind === "shell").map((step) => ({ entry, step })),
	);

	it("parses every shell step as a script, so it runs as pasted", () => {
		// What the copy button writes must run as pasted, continuations included.
		for (const { entry, step } of shellSteps) {
			const result = spawnSync("sh", ["-n"], { encoding: "utf8", input: step.value });
			expect(result.status, `${entry.name}: ${step.label}\n${result.stderr}`).toBe(0);
		}
	});

	it("continues every split shell line with a trailing backslash", () => {
		const continued = shellSteps.flatMap(({ step }) => {
			const lines = step.value.split("\n");
			return lines.filter((_line, index) => lines[index + 1]?.startsWith("  "));
		});

		expect(continued.length).toBeGreaterThan(0);
		expect(continued.filter((line) => !line.endsWith(" \\"))).toEqual([]);
	});

	it("keeps the Antigravity config valid JSON", () => {
		const config = agentSetupEntries
			.flatMap((entry) => entry.steps)
			.find((step) => step.kind === "json");

		expect(JSON.parse(config?.value ?? "")).toEqual({
			mcpServers: { "sketchi-code-mode": { serverUrl: "https://playground.sketchi.app/mcp" } },
		});
	});
});
