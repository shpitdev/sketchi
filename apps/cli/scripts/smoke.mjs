import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const smokeDirectory = resolve(workspaceRoot, ".memory/cli-smoke");
const packageDirectory = resolve(workspaceRoot, ".memory/cli-package");
const bundleReportPath = resolve(workspaceRoot, ".memory/cli-bundle-report.json");

const requiredNodeVersion = JSON.parse(readFileSync(resolve(workspaceRoot, "package.json"), "utf8"))
	.engines.node;

if (process.versions.node !== requiredNodeVersion) {
	throw new Error(
		`CLI smoke requires Node ${requiredNodeVersion}; received ${process.versions.node}.`,
	);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function assertPng(bytes, label) {
	assert(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), label);
}

function collect(child) {
	return new Promise((complete, reject) => {
		const stdout = [];
		const stderr = [];
		child.stdout.on("data", (chunk) => stdout.push(chunk));
		child.stderr.on("data", (chunk) => stderr.push(chunk));
		child.on("error", reject);
		child.on("close", (code, signal) =>
			complete({
				code: code ?? -1,
				signal,
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
			}),
		);
	});
}

function run(file, args, options = {}) {
	const child = spawn(file, args, {
		cwd: options.cwd ?? workspaceRoot,
		env: options.env ?? process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const result = collect(child);
	if (options.input !== undefined) child.stdin.end(options.input);
	else child.stdin.end();
	return result;
}

function parseJson(buffer, label) {
	try {
		return JSON.parse(buffer.toString("utf8"));
	} catch (cause) {
		throw new Error(`${label} was not JSON: ${buffer.toString("utf8")}`, {
			cause,
		});
	}
}

function expectExit(result, expected, label) {
	assert(
		result.code === expected,
		`${label} exited ${String(result.code)} (expected ${String(expected)}): ${result.stderr.toString("utf8")}`,
	);
	assert(result.signal === null, `${label} ended with signal ${String(result.signal)}.`);
}

function inkBounds(bytes) {
	const png = PNG.sync.read(bytes);
	const background = [...png.data.subarray(0, 4)];
	let minX = png.width;
	let minY = png.height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < png.height; y += 1) {
		for (let x = 0; x < png.width; x += 1) {
			const offset = (y * png.width + x) * 4;
			if (
				png.data[offset] === background[0] &&
				png.data[offset + 1] === background[1] &&
				png.data[offset + 2] === background[2] &&
				png.data[offset + 3] === background[3]
			) {
				continue;
			}
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	return { width: png.width, height: png.height, minX, minY, maxX, maxY };
}

function assertInkHasPadding(bytes, label) {
	const bounds = inkBounds(bytes);
	const minimumPadding = 16;
	assert(bounds.maxX >= 0, `${label} contains no visible ink.`);
	assert(bounds.minX >= minimumPadding, `${label} clips ink at the left edge.`);
	assert(bounds.minY >= minimumPadding, `${label} clips ink at the top edge.`);
	assert(bounds.maxX <= bounds.width - minimumPadding - 1, `${label} clips ink at the right edge.`);
	assert(
		bounds.maxY <= bounds.height - minimumPadding - 1,
		`${label} clips ink at the bottom edge.`,
	);
}

const flowchart = {
	type: "flowchart",
	spec: {
		id: "release-flow",
		title: "Release approval",
		nodes: {
			start: "Change proposed",
			review: "Review evidence",
			decision: "Evidence complete?",
			approve: "Approve release",
			revise: "Request revision",
			end: "Release decision recorded",
		},
		edges: [
			["start", "review"],
			["review", "decision"],
			["decision", "approve", "Complete"],
			["decision", "revise", "Incomplete"],
			["approve", "end"],
			["revise", "end"],
		],
	},
};
await mkdir(smokeDirectory, { recursive: true });
const runRoot = await mkdtemp(resolve(smokeDirectory, "run-"));
let completed = false;
try {
	const archives = (await readdir(packageDirectory)).filter((name) => name.endsWith(".tgz")).sort();
	assert(archives.length === 1, "Expected exactly one packaged CLI archive.");
	const archive = resolve(packageDirectory, archives[0]);
	const packagedFiles = await run("tar", ["-tzf", archive]);
	expectExit(packagedFiles, 0, "list packaged CLI files");
	const packagedFileNames = packagedFiles.stdout.toString("utf8").trim().split("\n").sort();
	/** @type {{ files: Array<{ path: string }> }} */
	const bundleReport = parseJson(await readFile(bundleReportPath), "CLI bundle report");
	const expectedPackageFiles = [
		"package/README.md",
		"package/THIRD_PARTY_NOTICES",
		"package/package.json",
		...bundleReport.files.map(({ path }) => `package/${path}`),
	].sort();
	assert(
		JSON.stringify(packagedFileNames) === JSON.stringify(expectedPackageFiles),
		`Unexpected packaged CLI files: ${packagedFileNames.join(", ")}.`,
	);
	const archivedBundleHash = createHash("sha256");
	let archivedBundleBytes = 0;
	for (const file of bundleReport.files) {
		const archivedFile = await run("tar", ["-xOf", archive, `package/${file.path}`]);
		expectExit(archivedFile, 0, `read packaged CLI file ${file.path}`);
		archivedBundleBytes += archivedFile.stdout.byteLength;
		archivedBundleHash.update(file.path);
		archivedBundleHash.update("\0");
		archivedBundleHash.update(archivedFile.stdout);
		assert(
			createHash("sha256").update(archivedFile.stdout).digest("hex") === file.sha256,
			`Packaged ${file.path} does not match the exact-head report.`,
		);
	}
	const archivedBundleSha256 = archivedBundleHash.digest("hex");
	assert(
		archivedBundleSha256 === bundleReport.sha256,
		`Packaged CLI JavaScript SHA-256 ${archivedBundleSha256} does not match exact-head report ${String(bundleReport.sha256)}.`,
	);
	assert(
		archivedBundleBytes === bundleReport.bytes,
		`Packaged CLI JavaScript has ${String(archivedBundleBytes)} bytes; exact-head report has ${String(bundleReport.bytes)}.`,
	);
	const archivedReadme = await run("tar", ["-xOf", archive, "package/README.md"]);
	expectExit(archivedReadme, 0, "read packaged CLI README");
	const sourceReadme = await readFile(resolve(workspaceRoot, "apps/cli/README.md"));
	assert(
		archivedReadme.stdout.equals(sourceReadme),
		"Packaged CLI README does not match apps/cli/README.md.",
	);
	const archivedNotices = await run("tar", ["-xOf", archive, "package/THIRD_PARTY_NOTICES"]);
	expectExit(archivedNotices, 0, "read packaged third-party notices");
	assert(
		archivedNotices.stdout.includes(Buffer.from("Mozilla Public License 2.0")) &&
			archivedNotices.stdout.includes(Buffer.from("SIL OPEN FONT LICENSE")) &&
			archivedNotices.stdout.includes(Buffer.from("MIT License")) &&
			archivedNotices.stdout.includes(Buffer.from("is-ci 4.1.0")) &&
			archivedNotices.stdout.includes(Buffer.from("pako 3.0.3")) &&
			archivedNotices.stdout.includes(Buffer.from("Vitaly Puzrin and Andrei Tuputcyn")) &&
			archivedNotices.stdout.includes(Buffer.from("linkedom 0.18.14")) &&
			archivedNotices.stdout.includes(Buffer.from("htmlparser2 10.1.0")),
		"Packaged third-party notices omit a bundled dependency license.",
	);
	const installRoot = resolve(runRoot, "install");
	const homeRoot = resolve(runRoot, "home");
	const fixtureRoot = resolve(runRoot, "fixtures");
	await mkdir(homeRoot, { recursive: true });
	await mkdir(fixtureRoot, { recursive: true });

	const installed = await run("npm", [
		"install",
		"--prefix",
		installRoot,
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		archive,
	]);
	expectExit(installed, 0, "npm install packaged CLI");

	const preload = resolve(runRoot, "network-disabled.cjs");
	await writeFile(
		preload,
		`'use strict';\nconst blocked = () => { throw new Error('NETWORK_DISABLED_BY_SKETCHI_SMOKE'); };\nfor (const name of ['node:net','node:tls','node:http','node:https','node:http2','node:dgram']) { const value = require(name); for (const key of ['connect','createConnection','request','get','createClient','createSocket']) { if (typeof value[key] === 'function') value[key] = blocked; } }\nconst dns = require('node:dns'); for (const key of Object.keys(dns)) { if (/^(lookup|resolve)/.test(key) && typeof dns[key] === 'function') dns[key] = blocked; }\nglobalThis.fetch = blocked;\n`,
		"utf8",
	);

	const binary = resolve(installRoot, "node_modules/.bin/sketchi");
	const cliEnvironment = {
		...process.env,
		HOME: homeRoot,
		XDG_CONFIG_HOME: resolve(homeRoot, ".config"),
		NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${preload}`.trim(),
	};
	delete cliEnvironment.NO_COLOR;
	delete cliEnvironment.FORCE_COLOR;
	delete cliEnvironment.SKETCHI_GENERATE_ENDPOINT;
	// Generate must never touch the real clipboard during smoke, on any OS.
	cliEnvironment.SKETCHI_CLIPBOARD_COMMAND = "off";
	const cli = (args, input) => run(binary, args, { cwd: fixtureRoot, env: cliEnvironment, input });

	// Online environment for the loopback generate proof only; every other command
	// runs with the network disabled.
	const onlineEnvironment = { ...cliEnvironment };
	delete onlineEnvironment.NODE_OPTIONS;

	const zshCompletions = await cli(["--completions", "zsh"]);
	expectExit(zshCompletions, 0, "zsh completions");
	assert(
		zshCompletions.stdout
			.toString("utf8")
			.startsWith("#compdef sketchi\n###-begin-sketchi-completions-###\n"),
		"Built CLI did not emit the expected zsh completion script.",
	);
	assert(
		zshCompletions.stdout.includes(Buffer.from("compdef _sketchi sketchi")),
		"Zsh completion script did not register the sketchi completer.",
	);

	const bashCompletions = await cli(["--completions", "bash"]);
	expectExit(bashCompletions, 0, "bash completions");
	assert(
		bashCompletions.stdout.toString("utf8").startsWith("###-begin-sketchi-completions-###\n"),
		"Built CLI did not emit the expected bash completion script.",
	);
	assert(
		bashCompletions.stdout.includes(Buffer.from("complete -F _sketchi sketchi")),
		"Bash completion script did not register the sketchi completer.",
	);

	// Build a valid loopback API response through the exact packaged CLI, then
	// remove the seed record so generate must persist and export it itself.
	const generatedFlowchart = {
		...flowchart,
		spec: { ...flowchart.spec, id: "generated-release-flow" },
	};
	const seedGenerated = await cli([
		"create",
		"--json",
		JSON.stringify(generatedFlowchart),
		"--output",
		"json",
	]);
	expectExit(seedGenerated, 0, "generate response seed");
	const generatedRecord = resolve(homeRoot, ".sketchi/diagrams/generated-release-flow");
	const generatedScene = parseJson(
		await readFile(resolve(generatedRecord, "scene.json")),
		"generated response scene",
	);
	const generatedExcalidraw = parseJson(
		await readFile(resolve(generatedRecord, "diagram.excalidraw")),
		"generated response Excalidraw",
	);
	await rm(generatedRecord, { force: true, recursive: true });

	const makeSuccessServer = (requests = []) =>
		createServer((request, response) => {
			const chunks = [];
			request.on("data", (chunk) => chunks.push(chunk));
			request.on("end", () => {
				requests.push(parseJson(Buffer.concat(chunks), "generate request"));
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						ok: true,
						status: "generated",
						diagram: {
							document: generatedFlowchart,
							scene: generatedScene,
							excalidraw: generatedExcalidraw,
						},
						generation: {
							model: "claude-haiku-5-5",
							provider: "smoke-loopback",
						},
					}),
				);
			});
		});
	const successServer = makeSuccessServer();
	await new Promise((ready) => successServer.listen(0, "127.0.0.1", ready));
	const successPort = successServer.address().port;
	let generatedDefault;
	try {
		generatedDefault = await run(
			binary,
			[
				"generate",
				"--prompt",
				"Create a release flow.",
				"--endpoint",
				`http://127.0.0.1:${String(successPort)}/api/v1/generate`,
				"--output",
				"json",
			],
			{ cwd: fixtureRoot, env: onlineEnvironment },
		);
	} finally {
		await new Promise((closed) => successServer.close(closed));
	}
	expectExit(generatedDefault, 0, "default generated PNG");
	const generatedStatus = parseJson(generatedDefault.stdout, "default generated PNG status");
	assert(
		generatedStatus.data.export.format === "png" &&
			generatedStatus.data.export.destination === "generated-release-flow.png",
		"Generate did not report its default PNG destination.",
	);
	const generatedPngPath = resolve(fixtureRoot, "generated-release-flow.png");
	const generatedPng = await readFile(generatedPngPath);
	assertPng(generatedPng, "Generate did not write a PNG by default.");
	assertInkHasPadding(generatedPng, "default generated PNG");
	assert(
		!(await readdir(generatedRecord)).includes("diagram.png"),
		"Generate wrote the rendered PNG back into the record.",
	);
	await rm(generatedRecord, { force: true, recursive: true });
	await rm(generatedPngPath, { force: true });

	// Network-down: the offline preload blocks fetch, so generate's HTTPS call fails
	// with the stable provider/network exit and leaves no partial local state.
	const networkDown = await cli([
		"generate",
		"--prompt",
		"Create a two-step release flow.",
		"--output",
		"json",
	]);
	expectExit(networkDown, 10, "generate network-down");
	assert(
		parseJson(networkDown.stderr, "generate network-down").error.code === "provider_failure",
		"Generate network-down did not use the stable error code.",
	);

	const emptyAfterGenerationFailures = await cli(["list", "--output", "json"]);
	expectExit(emptyAfterGenerationFailures, 0, "post-generation-failure list");
	assert(
		parseJson(emptyAfterGenerationFailures.stdout, "empty diagram list").data.length === 0,
		"Generation failures left partial local state.",
	);

	const createFlow = await cli(["create", "--json", JSON.stringify(flowchart), "--output", "json"]);
	expectExit(createFlow, 0, "flowchart create");
	assert(
		parseJson(createFlow.stdout, "flowchart create").data.id === "release-flow",
		"Unexpected flowchart id.",
	);

	const pngDestination = resolve(fixtureRoot, "release flow.png");
	const exportPng = await cli([
		"export",
		"release-flow",
		"--format",
		"png",
		"--dest",
		pngDestination,
	]);
	expectExit(exportPng, 0, "PNG file export");
	assert(exportPng.stdout.byteLength === 0, "PNG file export contaminated stdout.");
	const firstPng = await readFile(pngDestination);
	assertPng(firstPng, "PNG file export did not write a PNG signature.");
	assertInkHasPadding(firstPng, "PNG file export");

	const summary = {
		node: process.versions.node,
		package: archives[0],
		flows: ["generate:loopback-default-png", "flowchart:create-export-png-offline"],
		expectedFailures: ["generate-network-down:10"],
		network: "offline create/export; generate loopback proof excepted",
		home: "isolated-under-.memory",
		bundle: {
			bytes: archivedBundleBytes,
			sha256: archivedBundleSha256,
			entryBytes: bundleReport.entryBytes,
			files: bundleReport.files,
		},
		packageFiles: packagedFileNames,
		completions: ["zsh", "bash"],
	};
	await writeFile(
		resolve(smokeDirectory, "latest.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
		"utf8",
	);
	completed = true;
	process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
	if (completed) await rm(runRoot, { force: true, recursive: true });
}
