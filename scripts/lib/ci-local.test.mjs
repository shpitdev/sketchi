import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	acquireSlot,
	assertSignoffReady,
	nxFailedTasks,
	nxTaskOutputs,
	onlyVitestTimeouts,
	runTests,
} from "../ci-local.mjs";

const timedOut = (file) =>
	[
		` ❯ ${file} (2 tests | 1 failed) 53ms`,
		"⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
		"",
		` FAIL  ${file} > slow`,
		"Error: Test timed out in 5000ms.",
		'If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".',
	].join("\n");
const assertionFailed = (file) =>
	[
		` FAIL  ${file} > bad`,
		"AssertionError: expected 1 to be 2 // Object.is equality",
		"",
		"- Expected",
	].join("\n");
const nxLog = (blocks, failed) =>
	[
		"\u001b[7m NX \u001b[27m  Running target test for 3 projects:",
		...Object.entries(blocks).flatMap(([task, output]) => [
			`\u001b[2m> \u001b[22m\u001b[2mnx run\u001b[22m ${task}`,
			output,
			"",
		]),
		` NX   Ran target test for 3 projects (4s)`,
		"",
		`   ✖  ${failed.length}/3 failed`,
		"",
		"   Failed tasks:",
		"",
		...failed.map((task) => `   - ${task}`),
		"",
		"   Hint: run with --verbose",
	].join("\n");

test("Nx static output splits into task blocks and failed tasks", () => {
	const log = nxLog(
		{ "a:test": timedOut("a.test.ts"), "b:test": "ok", "c:build": "error TS2304" },
		["a:test", "c:build"],
	);
	const outputs = nxTaskOutputs(log);
	assert.deepEqual([...outputs.keys()], ["a:test", "b:test", "c:build"]);
	assert.match(outputs.get("a:test"), /Test timed out/);
	assert.doesNotMatch(outputs.get("b:test"), /c:build|TS2304/);
	assert.deepEqual(nxFailedTasks(log), ["a:test", "c:build"]);
	assert.deepEqual(nxFailedTasks("no summary"), []);
});

test("Vitest output that failed only on test or hook timeouts is told apart", () => {
	assert.ok(onlyVitestTimeouts(timedOut("a.test.ts")));
	assert.ok(
		onlyVitestTimeouts(" FAIL  a.test.ts [ a.test.ts ]\nError: Hook timed out in 10000ms.\n"),
	);
	assert.ok(!onlyVitestTimeouts(`${timedOut("a.test.ts")}\n${assertionFailed("b.test.ts")}`));
	assert.ok(!onlyVitestTimeouts(`${timedOut("a.test.ts")}\n⎯⎯ Unhandled Errors ⎯⎯\nboom`));
	assert.ok(!onlyVitestTimeouts("error TS2304: Cannot find name 'x'."));
});

function fakeTests(first, reruns = {}) {
	const calls = [];
	return {
		calls,
		runAll: async () => {
			calls.push("all");
			return { code: first.code, output: first.output, log: "test.log" };
		},
		runTask: async (task) => {
			calls.push(task);
			return { code: reruns[task] ?? 0, log: `${task}.log` };
		},
	};
}

test("a test task that only timed out is rerun alone and passes", async () => {
	for (const task of ["a:test", "diagrams:test-quadrant"]) {
		const fake = fakeTests({
			code: 1,
			output: nxLog({ [task]: timedOut("a.test.ts"), "b:test": "ok" }, [task]),
		});
		assert.deepEqual(await runTests(fake), {
			ok: true,
			reruns: [{ task, passed: true }],
			logs: [],
		});
		assert.deepEqual(fake.calls, ["all", task]);
	}
});

test("a test task that times out again when rerun alone fails the gate", async () => {
	const fake = fakeTests(
		{ code: 1, output: nxLog({ "a:test": timedOut("a.test.ts") }, ["a:test"]) },
		{ "a:test": 1 },
	);
	assert.deepEqual(await runTests(fake), {
		ok: false,
		reruns: [{ task: "a:test", passed: false }],
		logs: ["a:test.log"],
	});
});

test("any other failure fails at once, even beside a timeout", async () => {
	for (const output of [
		nxLog({ "a:test": timedOut("a.test.ts"), "b:test": assertionFailed("b.test.ts") }, [
			"a:test",
			"b:test",
		]),
		nxLog({ "a:test": timedOut("a.test.ts"), "c:build": "error TS2304" }, ["a:test", "c:build"]),
		"Nx crashed before listing failed tasks",
	]) {
		const fake = fakeTests({ code: 1, output });
		assert.deepEqual(await runTests(fake), { ok: false, reruns: [], logs: ["test.log"] });
		assert.deepEqual(fake.calls, ["all"]);
	}
});

function scratch(t, prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("a slot waits while every slot is held and goes to the first one released", async (t) => {
	const dir = scratch(t, "ci-local-slots-");
	const releaseFirst = await acquireSlot({ dir, slots: 2, pollMs: 5 });
	const releaseSecond = await acquireSlot({ dir, slots: 2, pollMs: 5 });
	let waitedOn;
	const third = acquireSlot({
		dir,
		slots: 2,
		pollMs: 5,
		onWait: (holders) => (waitedOn ??= holders),
	});
	while (!waitedOn) await new Promise((resolve) => setTimeout(resolve, 5));
	releaseFirst();
	const releaseThird = await third;
	assert.equal(waitedOn.length, 2);
	releaseSecond();
	releaseThird();
});

const gateModule = new URL("../ci-local.mjs", import.meta.url).href;

// A separate process holding slots, as another gate on the machine would.
function slotProcess(script, ...args) {
	return spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { acquireSlot } from ${JSON.stringify(gateModule)};\n${script}`,
			...args,
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
}

test("a slot held by a gate that was killed is free again", async (t) => {
	const dir = scratch(t, "ci-local-slots-");
	const holder = slotProcess(
		`await acquireSlot({ dir: process.argv[1], slots: 1, pollMs: 5 });
		console.log("held");
		setInterval(() => {}, 1000);`,
		dir,
	);
	t.after(() => holder.kill("SIGKILL"));
	await once(holder.stdout, "data");
	let waitedOn;
	const waiting = acquireSlot({ dir, slots: 1, pollMs: 5, onWait: (h) => (waitedOn ??= h) });
	while (!waitedOn) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(waitedOn[0].pid, holder.pid);
	holder.kill("SIGKILL");
	const release = await waiting;
	release();
});

test("contending gates never hold more slots than there are", async (t) => {
	const dir = scratch(t, "ci-local-slots-");
	const active = join(dir, "active");
	mkdirSync(active);
	const workers = Array.from({ length: 6 }, () =>
		slotProcess(
			`import { readdirSync, rmSync, writeFileSync } from "node:fs";
			const [dir, active] = process.argv.slice(1);
			let most = 0;
			for (let round = 0; round < 200; round++) {
				const release = await acquireSlot({ dir, slots: 2, pollMs: 1 });
				const marker = active + "/" + process.pid;
				writeFileSync(marker, "");
				most = Math.max(most, readdirSync(active).length);
				await new Promise((resolve) => setTimeout(resolve, Math.random()));
				rmSync(marker);
				release();
			}
			console.log(most);`,
			dir,
			active,
		),
	);
	const most = await Promise.all(
		workers.map(async (worker) => {
			let output = "";
			worker.stdout.on("data", (chunk) => (output += chunk));
			const [code] = await once(worker, "exit");
			assert.equal(code, 0);
			return Number(output);
		}),
	);
	assert.ok(Math.max(...most) <= 2, `held at once: ${most.join(", ")}`);
	assert.ok(Math.max(...most) === 2, "the contention never filled both slots");
});

function repository(t) {
	const cwd = scratch(t, "ci-local-repo-");
	// Fixtures must not read developer-global config or run its hooks.
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_COUNT: "0",
	};
	const git = (...args) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@example.com",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd, env, encoding: "utf8" },
		).trim();
	git("init", "--quiet");
	writeFileSync(join(cwd, "a.txt"), "one\n");
	git("add", "a.txt");
	git("commit", "--quiet", "-m", "one");
	return { cwd, git, head: () => git("rev-parse", "HEAD") };
}

test("signoff takes the HEAD the open PR has", (t) => {
	const { cwd, head } = repository(t);
	assert.equal(assertSignoffReady({ cwd, pr: { number: 7, headRefOid: head() } }), head());
});

test("signoff refuses a worktree with uncommitted or untracked changes", (t) => {
	const { cwd, head } = repository(t);
	writeFileSync(join(cwd, "b.txt"), "new\n");
	assert.throws(
		() => assertSignoffReady({ cwd, pr: { number: 7, headRefOid: head() } }),
		/uncommitted changes/,
	);
});

test("signoff refuses a HEAD that is not pushed to the PR, or no PR", (t) => {
	const { cwd, git, head } = repository(t);
	const pushed = head();
	writeFileSync(join(cwd, "a.txt"), "two\n");
	git("commit", "--quiet", "-am", "two");
	assert.throws(
		() => assertSignoffReady({ cwd, pr: { number: 7, headRefOid: pushed } }),
		/is not the head of PR #7/,
	);
	assert.throws(() => assertSignoffReady({ cwd, pr: undefined }), /no open PR/);
});

// Runs the real gate in a real temporary Git repository. Only paid/heavy child commands
// are fixtures: these tests prove selection and base/dirty-state behavior, not Nx execution.
function gateFixture(t) {
	const repo = repository(t);
	const state = scratch(t, "ci-local-commands-");
	const bin = join(state, "bin");
	mkdirSync(bin);
	const calls = join(state, "calls.jsonl");
	for (const name of ["pnpm", "gh"]) {
		writeFileSync(
			join(bin, name),
			`#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.GATE_CALLS, JSON.stringify({ command: ${JSON.stringify(name)}, args }) + "\\n");
if (${JSON.stringify(name)} === "pnpm" && args.includes("show")) console.log(process.env.GATE_PROJECTS);
if (${JSON.stringify(name)} === "gh" && args[0] === "pr") console.log(JSON.stringify({ number: 7, state: "OPEN", headRefOid: process.env.GATE_HEAD }));
`,
			{ mode: 0o755 },
		);
	}
	const cli = join(repo.cwd, "packages/diagram/scenarios/dist");
	mkdirSync(cli, { recursive: true });
	writeFileSync(join(cli, "cli.js"), "// Scenario CLI fixture: exits successfully.\n");
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
	return {
		...repo,
		routing,
		unitBase,
		write(file, content = "// changed\n") {
			mkdirSync(join(repo.cwd, file, ".."), { recursive: true });
			writeFileSync(join(repo.cwd, file), content);
		},
		run(args, projects = ["diagrams", "drawing"]) {
			writeFileSync(calls, "");
			const output = execFileSync(
				process.execPath,
				[new URL("../ci-local.mjs", import.meta.url).pathname, ...args],
				{
					cwd: repo.cwd,
					encoding: "utf8",
					env: {
						...process.env,
						PATH: `${bin}:${process.env.PATH}`,
						XDG_CACHE_HOME: join(state, "cache"),
						GATE_CALLS: calls,
						GATE_PROJECTS: JSON.stringify(projects),
						GATE_HEAD: repo.head(),
						CI_LOCAL_SLOTS: "1",
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			const commands = readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
			return {
				output,
				commands,
				routing: commands.filter(({ args }) => args.includes("drawing:routing-sample")),
			};
		},
	};
}

test("unit gates include committed, staged, unstaged and untracked routing inputs", (t) => {
	for (const state of ["committed", "staged", "unstaged", "untracked"]) {
		const fixture = gateFixture(t);
		const file = state === "untracked" ? "packages/drawing/src/new-schema.ts" : fixture.routing;
		fixture.write(file);
		if (state === "committed" || state === "staged") fixture.git("add", file);
		if (state === "committed") fixture.git("commit", "--quiet", "-m", "routing change");
		const result = fixture.run(["--no-signoff", "--base", fixture.unitBase]);
		assert.equal(result.routing.length, 1, state);
		assert.match(result.output, /✓ sampled routing/, state);
	}
});

test("unit gates use the committed merge base, not a direct diff of divergent refs", (t) => {
	const fixture = gateFixture(t);
	fixture.git("branch", "verified");
	fixture.write(fixture.routing);
	fixture.git("commit", "--quiet", "-am", "routing change");
	fixture.git("checkout", "--quiet", "verified");
	fixture.write("a.txt", "other staging work\n");
	fixture.git("commit", "--quiet", "-am", "other staging work");
	fixture.git("checkout", "--quiet", "unit");
	assert.equal(fixture.run(["--no-signoff", "--base", "verified"]).routing.length, 1);
});

test("an edited state document retains default tests without selecting sampled routing", (t) => {
	const fixture = gateFixture(t);
	const parser = "packages/diagrams/src/families/state-machine/document.ts";
	fixture.write(parser, "// original state parser\n");
	fixture.git("add", parser);
	fixture.git("commit", "--quiet", "-m", "state parser fixture");
	const base = fixture.head();
	fixture.write(parser, "// changed state parser\n");
	const result = fixture.run(["--no-signoff", "--base", base]);
	assert.equal(result.routing.length, 0);
	assert.match(result.output, /sampled routing: not affected/);
	for (const target of ["test", "typecheck,build"]) {
		assert.ok(
			result.commands.some(
				({ args }) =>
					args.includes("affected") &&
					args.some((arg) => arg === target || arg.startsWith(`${target},`)),
			),
			target,
		);
	}
});

test("a plain-family unit gate retains default tests without running sampled routing", (t) => {
	const fixture = gateFixture(t);
	fixture.write("packages/diagrams/src/families/timeline/render.ts");
	const result = fixture.run(["--no-signoff", "--base", fixture.unitBase]);
	assert.equal(result.routing.length, 0);
	assert.match(result.output, /sampled routing: not affected/);
	for (const target of ["test", "typecheck,build"]) {
		assert.ok(
			result.commands.some(
				({ args }) =>
					args.includes("affected") &&
					args.some((arg) => arg === target || arg.startsWith(`${target},`)),
			),
			target,
		);
	}
	assert.ok(!result.commands.some(({ command }) => command === "gh"));
});

test("origin/main, an equivalent explicit base, --all and signoff always run routing once", (t) => {
	const fixture = gateFixture(t);
	for (const args of [
		["--no-signoff"],
		["--no-signoff", "--base", fixture.git("rev-parse", "main")],
		["--no-signoff", "--all", "--base", fixture.unitBase],
		[],
	]) {
		const result = fixture.run(args, []);
		assert.equal(result.routing.length, 1, JSON.stringify(args));
		assert.equal(
			result.commands.filter(({ args }) => args.includes("POST")).length,
			args.length ? 0 : 1,
		);
		if (args.includes("--all")) {
			assert.ok(
				result.commands.some(
					({ args }) =>
						args.includes("run-many") && args.some((arg) => arg.split(",").includes("test")),
				),
			);
		}
	}
});

test("a unit base still cannot sign off, even with --all", (t) => {
	const fixture = gateFixture(t);
	assert.throws(
		() => fixture.run(["--all", "--base", fixture.unitBase]),
		(error) => /Signoff requires the full gate against origin\/main/.test(String(error.stderr)),
	);
});

test("help explains sampled routing without executing checks", (t) => {
	const result = gateFixture(t).run(["--help"]);
	assert.match(result.output, /sampled routing/);
	assert.match(result.output, /always for origin\/main and --all/);
	assert.deepEqual(result.commands, []);
});
