// Exercise `ops ci-local` in a real temporary Git repository, with `pnpm` and `gh`
// as recording stubs for the signoff contract.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Scope } from "effect";
import { describe, expect, onTestFinished, test } from "vitest";

import { acquireSlot } from "../src/ci-local/slots";
import { executable, jiti, repoRoot, repository, scratch } from "./harness";

interface Call {
	readonly command: string;
	readonly args: string[];
}

function gateFixture() {
	const repo = repository();
	const state = scratch("ops-gate-");
	const bin = join(state, "bin");
	mkdirSync(bin);
	const calls = join(state, "calls.jsonl");
	for (const name of ["pnpm", "gh"]) {
		executable(
			join(bin, name),
			`import { appendFileSync } from "node:fs";
const name = ${JSON.stringify(name)};
const args = process.argv.slice(2);
appendFileSync(process.env.GATE_CALLS, JSON.stringify({ command: name, args }) + "\\n");
if (name === "gh" && args[0] === "pr") {
	if (process.env.GATE_NO_PR) { console.error("no pull requests found for branch"); process.exit(1); }
	console.log(JSON.stringify({ number: 7, state: "OPEN", headRefOid: process.env.GATE_HEAD }));
}
if (name === "pnpm" && args.includes("-t") && process.env.GATE_NX_FAILURE) process.exit(1);
`,
		);
	}
	mkdirSync(join(repo.cwd, "tools/ops"), { recursive: true });
	writeFileSync(
		join(repo.cwd, "tools/ops/project.json"),
		JSON.stringify({ targets: { "check-workflows": {}, typecheck: {} } }),
	);
	mkdirSync(join(repo.cwd, "packages/diagrams"), { recursive: true });
	writeFileSync(
		join(repo.cwd, "packages/diagrams/project.json"),
		JSON.stringify({ targets: { "test-timeline": {}, "test-graph": {} } }),
	);
	writeFileSync(join(repo.cwd, ".gitignore"), ".memory/\n");
	repo.git("add", ".");
	repo.git("commit", "--quiet", "-m", "gate fixtures");
	repo.git("branch", "-f", "main");
	repo.git("remote", "add", "origin", repo.cwd);
	repo.git("checkout", "--quiet", "-b", "unit");
	writeFileSync(join(repo.cwd, "a.txt"), "verified staging\n");
	repo.git("commit", "--quiet", "-am", "verified staging");
	const unitBase = repo.head();
	const env = (extra: Record<string, string> = {}) => ({
		...process.env,
		PATH: `${bin}:${process.env["PATH"]}`,
		XDG_CACHE_HOME: join(state, "cache"),
		GATE_CALLS: calls,
		GATE_HEAD: repo.head(),
		CI_LOCAL_SLOTS: "1",
		...extra,
	});
	const readCalls = (): Call[] =>
		existsSync(calls)
			? readFileSync(calls, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line) as Call)
			: [];
	const result = (gate: { status: number | null; stdout: string; stderr: string }) => {
		const commands = readCalls();
		return {
			...gate,
			nx: commands.filter(({ command, args }) => command === "pnpm" && args.includes("-t")),
			posted: commands.filter(({ args }) => args.includes("POST")),
		};
	};
	return {
		...repo,
		unitBase,
		/** The typed gate, as the bootstrap execs it. */
		run(args: string[], extra: Record<string, string> = {}) {
			writeFileSync(calls, "");
			return result(
				spawnSync(jiti, [join(repoRoot, "tools/ops/src/main.ts"), "ci-local", ...args], {
					cwd: repo.cwd,
					encoding: "utf8",
					env: env(extra),
				}),
			);
		},
	};
}

describe("ci-local gate", () => {
	test("includes the Storybook check in a unit gate", () => {
		const fixture = gateFixture();
		const result = fixture.run(["--no-signoff", "--base", fixture.unitBase]);
		expect(result.status, result.stderr).toBe(0);
		const [nx] = result.nx;
		expect(nx?.args).toContain(
			"typecheck,build,test,check-scenario,check-storybook,test-timeline,test-graph,check-workflows,routing-sample",
		);
	});

	test("posts local-ci for the PR head only when signing off", () => {
		const fixture = gateFixture();
		const unsigned = fixture.run(["--no-signoff"]);
		expect(unsigned.status, unsigned.stderr).toBe(0);
		expect(unsigned.posted).toHaveLength(0);

		const signed = fixture.run([]);
		expect(signed.status, signed.stderr).toBe(0);
		expect(signed.posted).toHaveLength(1);
		expect(signed.posted[0]?.args).toEqual(
			expect.arrayContaining([
				`repos/{owner}/{repo}/statuses/${fixture.head()}`,
				"context=local-ci",
				"state=success",
			]),
		);
	});

	test("a unit base cannot sign off, even with --all", () => {
		const fixture = gateFixture();
		const result = fixture.run(["--all", "--base", fixture.unitBase]);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/Signoff requires the full gate against origin\/main/);
		expect(result.nx).toHaveLength(0);
		expect(result.posted).toHaveLength(0);
	});

	test("signoff refuses a dirty worktree, an unpushed HEAD or no PR before running checks", () => {
		const fixture = gateFixture();
		writeFileSync(join(fixture.cwd, "b.txt"), "untracked\n");
		const dirty = fixture.run([]);
		expect(dirty.stderr).toMatch(/uncommitted changes/);
		fixture.git("add", "b.txt");
		fixture.git("commit", "--quiet", "-m", "b");
		const unpushed = fixture.run([], { GATE_HEAD: fixture.unitBase });
		expect(unpushed.stderr).toMatch(/is not the head of PR #7/);
		const noPr = fixture.run([], { GATE_NO_PR: "1" });
		expect(noPr.stderr).toMatch(/no open PR/);
		for (const result of [dirty, unpushed, noPr]) {
			expect(result.status).toBe(1);
			expect(result.nx).toHaveLength(0);
			expect(result.posted).toHaveLength(0);
		}
	});

	test("does not sign off when the checks fail", () => {
		const fixture = gateFixture();
		const result = fixture.run([], { GATE_NX_FAILURE: "1" });
		expect(result.status).toBe(1);
		expect(result.nx.length).toBeGreaterThan(0);
		expect(result.posted).toHaveLength(0);
	});
});

describe("gate slots", () => {
	it.live("a slot waits while every slot is held and goes to the first one released", () =>
		Effect.gen(function* () {
			const dir = scratch("ops-slots-");
			const first = yield* Scope.make();
			yield* acquireSlot({ dir, slots: 2, pollInterval: "5 millis" }).pipe(Scope.provide(first));
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* acquireSlot({ dir, slots: 2, pollInterval: "5 millis" });
					const waited = yield* Deferred.make<number>();
					const third = yield* Effect.forkChild(
						Effect.scoped(
							acquireSlot({
								dir,
								slots: 2,
								pollInterval: "5 millis",
								onWait: (holders) => Deferred.succeed(waited, holders.length).pipe(Effect.asVoid),
							}),
						),
					);
					expect(yield* Deferred.await(waited)).toBe(2);
					yield* Scope.close(first, undefined as never);
					expect(yield* Fiber.join(third)).toBe(0);
				}),
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	function holder(...args: string[]) {
		const child = spawn(
			jiti,
			[join(repoRoot, "tools/ops/tests/fixtures/slot-holder.ts"), ...args],
			{
				stdio: ["ignore", "pipe", "inherit"],
			},
		);
		onTestFinished(() => {
			child.kill("SIGKILL");
		});
		return child;
	}

	it.live("a slot held by a gate that was killed is free again", () =>
		Effect.gen(function* () {
			const dir = scratch("ops-slots-");
			const other = holder("hold", dir);
			yield* Effect.promise(() => once(other.stdout, "data"));
			const waitedOn = yield* Deferred.make<number>();
			const waiting = yield* Effect.forkChild(
				Effect.scoped(
					acquireSlot({
						dir,
						slots: 1,
						pollInterval: "5 millis",
						onWait: ([held]) => Deferred.succeed(waitedOn, held?.pid ?? 0).pipe(Effect.asVoid),
					}),
				),
			);
			expect(yield* Deferred.await(waitedOn)).toBe(other.pid);
			other.kill("SIGKILL");
			expect(yield* Fiber.join(waiting)).toBe(0);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	test("contending gates never hold more slots than there are", async () => {
		const dir = scratch("ops-slots-");
		const active = join(dir, "active");
		mkdirSync(active);
		const most = await Promise.all(
			Array.from({ length: 6 }, async () => {
				const worker = holder("contend", dir, active);
				let output = "";
				worker.stdout.on("data", (chunk) => (output += chunk));
				const [code] = (await once(worker, "exit")) as [number];
				expect(code).toBe(0);
				return Number(output);
			}),
		);
		expect(Math.max(...most)).toBe(2);
	});
});
