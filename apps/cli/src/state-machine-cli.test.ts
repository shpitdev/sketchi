import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");

describe("offline state-machine input failures", () => {
	it.each([
		{ name: "unknown initial state", issue: "unknown_initial_state", initial: "nowhere" },
		{ name: "unreachable state", issue: "unreachable_node", initial: "locked", orphan: true },
	])("reports $name as invalid_document with exit 3", ({ initial, issue, orphan }) => {
		const environment = { ...process.env };
		delete environment["FORCE_COLOR"];
		delete environment["NO_COLOR"];
		const spec = {
			title: "Invalid turnstile",
			initial,
			states: [
				{ id: "locked", label: "Locked" },
				{ id: "unlocked", label: "Unlocked" },
				...(orphan ? [{ id: "broken", label: "Broken" }] : []),
			],
			transitions: [
				{ source: "locked", target: "unlocked", event: "coin" },
				{ source: "unlocked", target: "locked", event: "push" },
			],
		};
		const result = spawnSync(
			process.execPath,
			[
				binary,
				"create",
				"--output",
				"json",
				"--json",
				JSON.stringify({ type: "state-machine", spec }),
			],
			{ encoding: "utf8", timeout: 20_000, env: environment },
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(3);
		const output: { ok: boolean; error: { code: string; details: string[] } } = JSON.parse(
			result.stderr,
		);
		expect(output).toMatchObject({ ok: false, error: { code: "invalid_document" } });
		expect(output.error.details.some((detail) => detail.startsWith(issue))).toBe(true);
	});
});
