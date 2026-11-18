// @effect-diagnostics nodeBuiltinImport:off -- The gate test owns subprocesses and fixtures to verify the preinstall and exec boundary.

// The local CI gate at its real command boundary: `ops ci-local` (and the bootstrap) in a real
// temporary Git repository, with `pnpm` and `gh` as recording stubs. These prove base, selection,
// failure, signoff, slot and interruption behavior, not Nx execution.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Scope } from "effect";
import { describe, expect, onTestFinished, test } from "vitest";

import { acquireSlot } from "../src/ci-local/slots";
import { executable, jiti, repoRoot, repository, scratch, startOps } from "./harness";

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
			`import { appendFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const name = ${JSON.stringify(name)};
const args = process.argv.slice(2);
appendFileSync(process.env.GATE_CALLS, JSON.stringify({ command: name, args }) + "\\n");
if (name === "gh" && args[0] === "pr") {
	if (process.env.GATE_NO_PR) { console.error("no pull requests found for branch"); process.exit(1); }
	console.log(JSON.stringify({ number: 7, state: "OPEN", headRefOid: process.env.GATE_HEAD }));
}
if (args[0] === "install" && process.env.GATE_INSTALL_FAILURE) {
	console.log(process.env.GATE_INSTALL_FAILURE);
	process.exit(1);
}
if (args.includes("-t") && process.env.GATE_NX_HANG) {
	const child = spawn("sleep", ["300"], { stdio: "ignore" });
	writeFileSync(process.env.GATE_NX_HANG, String(child.pid));
	setInterval(() => {}, 1000);
} else if (args.includes("-t") && process.env.GATE_NX_FAILURE) {
	console.log(process.env.GATE_NX_FAILURE);
	process.exit(1);
}
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
	const routing = "packages/diagrams/src/graph/routing.ts";
	mkdirSync(join(repo.cwd, "packages/diagrams/src/graph"), { recursive: true });
	writeFileSync(join(repo.cwd, routing), "// original routing\n");
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
		// @effect-diagnostics-next-line processEnv:off -- The subprocess test prepends fixture binaries to the real host PATH.
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
			commands,
			routing: commands.filter(({ args }) => args.includes("diagrams:routing-sample")),
			nx: commands.filter(({ command, args }) => command === "pnpm" && args.includes("-t")),
			posted: commands.filter(({ args }) => args.includes("POST")),
		};
	};
	return {
		...repo,
		routing,
		unitBase,
		calls,
		env,
		write(file: string, content = "// changed\n") {
			mkdirSync(join(repo.cwd, file, ".."), { recursive: true });
			writeFileSync(join(repo.cwd, file), content);
		},
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
		/** `pnpm ci:local`: the bootstrap, which installs and then execs the gate. */
		bootstrap(args: string[], extra: Record<string, string> = {}) {
			writeFileSync(calls, "");
			return result(
				spawnSync(process.execPath, [join(repoRoot, "tools/ops/ci-local.mjs"), ...args], {
					cwd: repo.cwd,
					encoding: "utf8",
					env: env(extra),
				}),
			);
		},
	};
}

describe("ci-local gate", () => {
	test("unit gates pass Nx the merge base without a HEAD override, keeping dirty and untracked changes", () => {
		const fixture = gateFixture();
		fixture.write(fixture.routing);
		fixture.git("add", fixture.routing);
		fixture.git("commit", "--quiet", "-m", "routing change");
		fixture.write("a.txt", "unstaged\n");
		fixture.write("new.txt", "untracked\n");
		const result = fixture.run(["--no-signoff", "--base", fixture.unitBase]);
		expect(result.status, result.stderr).toBe(0);
		const [nx] = result.nx;
		expect(nx?.args).toContain(`--base=${fixture.unitBase}`);
		expect(nx?.args.some((arg) => arg.startsWith("--head"))).toBe(false);
		expect(nx?.args).toContain(
			"typecheck,build,test,check-scenario,check-storybook,test-timeline,test-graph,check-workflows,routing-sample",
		);
		expect(result.routing).toHaveLength(0);
		expect(result.commands.some(({ command }) => command === "gh")).toBe(false);
	});

	test("unit gates use the committed merge base for divergent refs", () => {
		const fixture = gateFixture();
		fixture.git("branch", "verified");
		fixture.write(fixture.routing);
		fixture.git("commit", "--quiet", "-am", "routing change");
		fixture.git("checkout", "--quiet", "verified");
		fixture.write("a.txt", "other staging work\n");
		fixture.git("commit", "--quiet", "-am", "other staging work");
		fixture.git("checkout", "--quiet", "unit");
		const result = fixture.run(["--no-signoff", "--base", "verified"]);
		expect(result.nx[0]?.args).toContain(`--base=${fixture.unitBase}`);
	});

	test("origin/main, an equivalent base, --all and signoff run routing once; only signoff posts", () => {
		const fixture = gateFixture();
		for (const args of [
			["--no-signoff"],
			["--no-signoff", "--base", fixture.git("rev-parse", "main")],
			["--no-signoff", "--all", "--base", fixture.unitBase],
			[],
		]) {
			const result = fixture.run(args);
			expect(result.status, `${args.join(" ")}\n${result.stderr}`).toBe(0);
			expect(result.routing).toHaveLength(1);
			expect(result.posted).toHaveLength(args.length ? 0 : 1);
			if (args.includes("--all")) expect(result.nx[0]?.args).toContain("run-many");
		}
	});

	test("a unit base cannot sign off, even with --all", () => {
		const fixture = gateFixture();
		const result = fixture.run(["--all", "--base", fixture.unitBase]);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/Signoff requires the full gate against origin\/main/);
		expect(result.nx).toHaveLength(0);
	});

	test("signoff refuses a dirty worktree, an unpushed HEAD or no PR before running checks", () => {
		const fixture = gateFixture();
		fixture.write("b.txt", "untracked\n");
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

	test("a failed Nx run fails the gate once, even on a test timeout, keeping its log and posting nothing", () => {
		const fixture = gateFixture();
		const timeout = [
			"> nx run a:test",
			" FAIL  a.test.ts > slow",
			"Error: Test timed out in 5000ms.",
			"Failed tasks:",
			"- a:test",
		].join("\n");
		const result = fixture.run([], { GATE_NX_FAILURE: timeout });
		expect(result.status).toBe(1);
		expect(result.nx).toHaveLength(1);
		expect(result.routing).toHaveLength(0);
		expect(result.posted).toHaveLength(0);
		expect(result.stdout).toMatch(/✖ native Nx checks/);
		expect(result.stderr).toMatch(/Test timed out in 5000ms/);
		expect(readFileSync(join(fixture.cwd, ".memory/ci-local/nx.log"), "utf8")).toMatch(
			/Test timed out in 5000ms/,
		);
	});

	test("the bootstrap stops at a failed frozen install and never starts the gate", () => {
		const fixture = gateFixture();
		const result = fixture.bootstrap(["--no-signoff"], {
			GATE_INSTALL_FAILURE: "ERR_PNPM_OUTDATED_LOCKFILE",
		});
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/✖ pnpm install/);
		expect(result.stderr).toMatch(/ERR_PNPM_OUTDATED_LOCKFILE/);
		expect(result.commands.map(({ args }) => args[0])).toEqual(["install"]);
	});

	test("the bootstrap installs frozen dependencies, then runs the gate in the same process", () => {
		const fixture = gateFixture();
		const result = fixture.bootstrap(["--no-signoff"]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.commands[0]?.args).toEqual(["install", "--frozen-lockfile", "--prefer-offline"]);
		expect(result.nx).toHaveLength(1);
		expect(result.stdout).toMatch(/✓ pnpm install in/);
	});

	test("interrupting the gate stops the check it started and that check's children", async () => {
		const fixture = gateFixture();
		const pidFile = join(scratch("ops-gate-hang-"), "grandchild.pid");
		const gate = startOps(["ci-local", "--no-signoff"], {
			cwd: fixture.cwd,
			env: fixture.env({ GATE_NX_HANG: pidFile }),
		});
		onTestFinished(() => {
			gate.kill("SIGKILL");
		});
		// @effect-diagnostics-next-line globalDate:off -- Measure the actual subprocess deadline, independently of the gate’s Effect clock.
		const deadline = Date.now() + 30_000;
		while (!existsSync(pidFile) || !readFileSync(pidFile, "utf8")) {
			// @effect-diagnostics-next-line globalDate:off -- Measure the actual subprocess deadline, independently of the gate’s Effect clock.
			if (Date.now() > deadline) throw new Error("the hanging check never started");
			// @effect-diagnostics-next-line globalTimers:off newPromise:off -- The harness bounds real child-process assertions independently of the gate runtime. The gate test bridges real subprocess output and exit events into the harness.
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const grandchild = Number(readFileSync(pidFile, "utf8"));
		const alive = (pid: number) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		expect(alive(grandchild)).toBe(true);
		gate.kill("SIGINT");
		const [code, signal] = (await once(gate, "exit")) as [number | null, string | null];
		expect(code !== 0 || signal !== null).toBe(true);
		// @effect-diagnostics-next-line globalDate:off -- Measure the actual subprocess deadline, independently of the gate’s Effect clock.
		const gone = Date.now() + 15_000;
		// @effect-diagnostics-next-line globalDate:off -- Measure the actual subprocess deadline, independently of the gate’s Effect clock.
		while (alive(grandchild) && Date.now() < gone) {
			// @effect-diagnostics-next-line globalTimers:off newPromise:off -- The harness bounds real child-process assertions independently of the gate runtime. The gate test bridges real subprocess output and exit events into the harness.
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(alive(grandchild)).toBe(false);
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
			// @effect-diagnostics-next-line strictEffectProvide:off -- This command harness owns the isolated Node and fixture layers for the test invocation.
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
			// @effect-diagnostics-next-line strictEffectProvide:off -- This command harness owns the isolated Node and fixture layers for the test invocation.
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
