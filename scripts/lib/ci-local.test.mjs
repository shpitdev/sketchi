import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireSlot, assertSignoffReady } from "../ci-local.mjs";

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
			console.log(JSON.stringify(most));`,
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
if (${JSON.stringify(name)} === "gh" && args[0] === "pr") console.log(JSON.stringify({ number: 7, state: "OPEN", headRefOid: process.env.GATE_HEAD }));
if (args.includes("-t") && process.env.GATE_NX_FAILURE) {
	console.log(process.env.GATE_NX_FAILURE);
	process.exit(1);
}
`,
			{ mode: 0o755 },
		);
	}
	mkdirSync(join(repo.cwd, "scripts"));
	writeFileSync(
		join(repo.cwd, "scripts/project.json"),
		JSON.stringify({ targets: { "check-process": {} } }),
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
	return {
		...repo,
		routing,
		unitBase,
		write(file, content = "// changed\n") {
			mkdirSync(join(repo.cwd, file, ".."), { recursive: true });
			writeFileSync(join(repo.cwd, file), content);
		},
		run(args, { nxFailure, status = 0 } = {}) {
			writeFileSync(calls, "");
			const gate = spawnSync(
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
						GATE_HEAD: repo.head(),
						CI_LOCAL_SLOTS: "1",
						...(nxFailure && { GATE_NX_FAILURE: nxFailure }),
					},
				},
			);
			assert.equal(gate.status, status, gate.stderr);
			const commands = readFileSync(calls, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
			return {
				output: gate.stdout,
				stderr: gate.stderr,
				commands,
				routing: commands.filter(({ args }) => args.includes("diagrams:routing-sample")),
			};
		},
	};
}

test("unit gates pass Nx the merge base without a HEAD override, preserving dirty/untracked selection", (t) => {
	const fixture = gateFixture(t);
	fixture.write(fixture.routing);
	fixture.git("add", fixture.routing);
	fixture.git("commit", "--quiet", "-m", "routing change");
	fixture.write("a.txt", "unstaged\n");
	fixture.write("new.txt", "untracked\n");
	const result = fixture.run(["--no-signoff", "--base", fixture.unitBase]);
	const nx = result.commands.find(({ args }) => args.includes("affected"));
	assert.ok(nx.args.includes(`--base=${fixture.unitBase}`));
	assert.ok(!nx.args.some((arg) => arg.startsWith("--head")));
	assert.ok(
		nx.args.includes(
			"typecheck,build,test,check-scenario,check-storybook,test-timeline,test-graph,check-process,routing-sample",
		),
	);
	assert.equal(result.routing.length, 0, "unit routing is selected by Nx, not forced");
	assert.ok(!result.commands.some(({ command }) => command === "gh"));
});

test("unit gates use the committed merge base for divergent refs", (t) => {
	const fixture = gateFixture(t);
	fixture.git("branch", "verified");
	fixture.write(fixture.routing);
	fixture.git("commit", "--quiet", "-am", "routing change");
	fixture.git("checkout", "--quiet", "verified");
	fixture.write("a.txt", "other staging work\n");
	fixture.git("commit", "--quiet", "-am", "other staging work");
	fixture.git("checkout", "--quiet", "unit");
	const { args } = fixture
		.run(["--no-signoff", "--base", "verified"])
		.commands.find(({ args }) => args.includes("affected"));
	assert.ok(args.includes(`--base=${fixture.unitBase}`));
});

test("origin/main, an equivalent explicit base, --all and signoff always run routing once", (t) => {
	const fixture = gateFixture(t);
	for (const args of [
		["--no-signoff"],
		["--no-signoff", "--base", fixture.git("rev-parse", "main")],
		["--no-signoff", "--all", "--base", fixture.unitBase],
		[],
	]) {
		const result = fixture.run(args);
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
	const { stderr } = fixture.run(["--all", "--base", fixture.unitBase], { status: 1 });
	assert.match(stderr, /Signoff requires the full gate against origin\/main/);
});

test("a failed Nx checks run fails the gate once, even on a test timeout, keeping its log", (t) => {
	const fixture = gateFixture(t);
	const timeout = [
		"> nx run a:test",
		" FAIL  a.test.ts > slow",
		"Error: Test timed out in 5000ms.",
		"Failed tasks:",
		"- a:test",
	].join("\n");
	const result = fixture.run([], { nxFailure: timeout, status: 1 });
	const nx = result.commands.filter(({ args }) => args[0] === "nx" && args[1] !== "sync:check");
	assert.equal(nx.length, 1, JSON.stringify(nx));
	assert.ok(nx[0].args.includes("-t"));
	assert.ok(!result.commands.some(({ args }) => args.includes("POST")));
	assert.match(result.output, /✖ native Nx checks/);
	const log = join(fixture.cwd, ".memory/ci-local/nx.log");
	assert.match(result.stderr, /Test timed out in 5000ms/);
	assert.match(readFileSync(log, "utf8"), /Test timed out in 5000ms/);
});

test("help explains sampled routing without executing checks", (t) => {
	const result = gateFixture(t).run(["--help"]);
	assert.match(result.output, /sampled routing/);
	assert.match(result.output, /Full origin\/main and --all/);
	assert.deepEqual(result.commands, []);
});
