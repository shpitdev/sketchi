import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	const fake = fakeTests({
		code: 1,
		output: nxLog({ "a:test": timedOut("a.test.ts"), "b:test": "ok" }, ["a:test"]),
	});
	assert.deepEqual(await runTests(fake), {
		ok: true,
		reruns: [{ task: "a:test", passed: true }],
		logs: [],
	});
	assert.deepEqual(fake.calls, ["all", "a:test"]);
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
