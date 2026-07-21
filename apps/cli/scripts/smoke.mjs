import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const smokeDirectory = resolve(workspaceRoot, ".memory/cli-smoke");
const packageDirectory = resolve(workspaceRoot, ".memory/cli-package");
const bundleReportPath = resolve(
  workspaceRoot,
  ".memory/cli-bundle-report.json",
);

if (process.versions.node !== "24.13.0") {
  throw new Error(
    `CLI smoke requires Node 24.13.0; received ${process.versions.node}.`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(file, args, options = {}) {
  return new Promise((complete, reject) => {
    const child = spawn(file, args, {
      cwd: workspaceRoot,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
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
  assert(
    result.signal === null,
    `${label} ended with signal ${String(result.signal)}.`,
  );
}

const flowchart = {
  type: "flowchart",
  spec: {
    id: "release-flow",
    title: "Release approval",
    nodes: [
      { id: "start", label: "Change proposed", kind: "start" },
      { id: "review", label: "Review evidence", kind: "process" },
      { id: "decision", label: "Evidence complete?", kind: "decision" },
      { id: "approve", label: "Approve release", kind: "process" },
      { id: "revise", label: "Request revision", kind: "process" },
      { id: "end", label: "Release decision recorded", kind: "end" },
    ],
    edges: [
      { source: "start", target: "review" },
      { source: "review", target: "decision" },
      { source: "decision", target: "approve", label: "Complete" },
      { source: "decision", target: "revise", label: "Incomplete" },
      { source: "approve", target: "end" },
      { source: "revise", target: "end" },
    ],
  },
};
const revisedFlowchart = {
  ...flowchart,
  spec: { ...flowchart.spec, title: "Release approval revised" },
};
const mindmap = {
  type: "mindmap",
  spec: {
    id: "launch-map",
    title: "Launch plan",
    root: {
      label: "Launch",
      children: [
        { label: "Product", children: [{ label: "Readiness review" }] },
        { label: "Operations", children: [{ label: "Runbook" }] },
        { label: "Communication", children: [{ label: "Announcement" }] },
      ],
    },
  },
};
const revisedMindmap = {
  ...mindmap,
  spec: { ...mindmap.spec, title: "Launch plan revised" },
};

await mkdir(smokeDirectory, { recursive: true });
const runRoot = await mkdtemp(resolve(smokeDirectory, "run-"));
let completed = false;
try {
  const archives = (await readdir(packageDirectory))
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  assert(archives.length === 1, "Expected exactly one packaged CLI archive.");
  const archive = resolve(packageDirectory, archives[0]);
  const bundleReport = parseJson(
    await readFile(bundleReportPath),
    "CLI bundle report",
  );
  const archivedBundle = await run("tar", [
    "-xOf",
    archive,
    "package/sketchi.js",
  ]);
  expectExit(archivedBundle, 0, "read packaged CLI bundle");
  const archivedBundleSha256 = createHash("sha256")
    .update(archivedBundle.stdout)
    .digest("hex");
  assert(
    archivedBundle.stdout.byteLength === bundleReport.bytes,
    `Packaged CLI bundle has ${String(archivedBundle.stdout.byteLength)} bytes; exact-head report has ${String(bundleReport.bytes)}.`,
  );
  assert(
    archivedBundleSha256 === bundleReport.sha256,
    `Packaged CLI bundle SHA-256 ${archivedBundleSha256} does not match exact-head report ${String(bundleReport.sha256)}.`,
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
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS ?? ""} --require=${preload}`.trim(),
  };
  delete cliEnvironment.NO_COLOR;
  delete cliEnvironment.FORCE_COLOR;
  delete cliEnvironment.CF_AIG_TOKEN;
  delete cliEnvironment.SKETCHI_AI_GATEWAY_ACCOUNT_ID;
  delete cliEnvironment.SKETCHI_AI_GATEWAY_ID;
  const cli = (args, input) =>
    run(binary, args, { env: cliEnvironment, input });

  const rootHelp = await cli(["--help"]);
  expectExit(rootHelp, 0, "root help");
  assert(
    rootHelp.stdout.includes(Buffer.from("Canonical flowchart example")),
    "Root help omitted flowchart guidance.",
  );
  assert(
    rootHelp.stdout.includes(Buffer.from("sole network boundary")),
    "Root help omitted the generation network boundary.",
  );

  const missingCredential = await cli([
    "generate",
    "--prompt",
    "Create a two-step release flow.",
    "--output",
    "json",
  ]);
  expectExit(missingCredential, 9, "missing generation credential");
  assert(
    parseJson(missingCredential.stderr, "missing generation credential").error
      .code === "missing_credential",
    "Missing generation credential did not use the stable error code.",
  );

  const blockedNetwork = await run(
    binary,
    [
      "generate",
      "--prompt",
      "Create a two-step release flow.",
      "--output",
      "json",
    ],
    {
      env: {
        ...cliEnvironment,
        CF_AIG_TOKEN: "blocked-network-proof-token",
      },
    },
  );
  expectExit(blockedNetwork, 10, "blocked generation network");
  assert(
    parseJson(blockedNetwork.stderr, "blocked generation network").error
      .code === "provider_failure",
    "Blocked generation network did not use the stable error code.",
  );

  const emptyAfterGenerationFailures = await cli(["list", "--output", "json"]);
  expectExit(emptyAfterGenerationFailures, 0, "post-generation-failure list");
  assert(
    parseJson(emptyAfterGenerationFailures.stdout, "empty diagram list").data
      .length === 0,
    "Generation failures left partial local state.",
  );

  const createFlow = await cli([
    "create",
    "--json",
    JSON.stringify(flowchart),
    "--output",
    "json",
  ]);
  expectExit(createFlow, 0, "flowchart create");
  assert(
    parseJson(createFlow.stdout, "flowchart create").data.id === "release-flow",
    "Unexpected flowchart id.",
  );

  const showFlow = await cli(["show", "release-flow", "--output", "json"]);
  expectExit(showFlow, 0, "flowchart show");
  assert(
    parseJson(showFlow.stdout, "flowchart show").data.document.spec.title ===
      "Release approval",
    "Flowchart show changed the canonical document.",
  );

  const revisedFlowPath = resolve(fixtureRoot, "flowchart-revised.json");
  await writeFile(
    revisedFlowPath,
    `${JSON.stringify(revisedFlowchart)}\n`,
    "utf8",
  );
  const editFlow = await cli([
    "edit",
    "release-flow",
    "--file",
    revisedFlowPath,
    "--output",
    "json",
  ]);
  expectExit(editFlow, 0, "flowchart edit");
  assert(
    parseJson(editFlow.stdout, "flowchart edit").data.revision === 2,
    "Flowchart revision did not advance.",
  );

  const showRevisedFlow = await cli([
    "show",
    "release-flow",
    "--output",
    "json",
  ]);
  expectExit(showRevisedFlow, 0, "revised flowchart show");
  const revisedFlowData = parseJson(
    showRevisedFlow.stdout,
    "revised flowchart show",
  ).data;
  assert(
    revisedFlowData.document.spec.title === "Release approval revised",
    "Flowchart edit was not visible.",
  );
  assert(
    revisedFlowData.revisions.length === 1,
    "Flowchart prior revision was not recoverable.",
  );

  const createMindmap = await cli(
    ["create", "--file", "-", "--output", "json"],
    `${JSON.stringify(mindmap)}\n`,
  );
  expectExit(createMindmap, 0, "mindmap stdin create");
  assert(
    parseJson(createMindmap.stdout, "mindmap create").data.id === "launch-map",
    "Unexpected mindmap id.",
  );

  const revisedMindmapPath = resolve(fixtureRoot, "mindmap-revised.json");
  await writeFile(
    revisedMindmapPath,
    `${JSON.stringify(revisedMindmap)}\n`,
    "utf8",
  );
  const editMindmap = await cli([
    "edit",
    "launch-map",
    "--file",
    revisedMindmapPath,
    "--output",
    "json",
  ]);
  expectExit(editMindmap, 0, "mindmap edit");
  const showMindmap = await cli(["show", "launch-map", "--output", "json"]);
  expectExit(showMindmap, 0, "mindmap show");
  assert(
    parseJson(showMindmap.stdout, "mindmap show").data.document.spec.title ===
      "Launch plan revised",
    "Mindmap edit was not visible.",
  );

  const list = await cli(["list", "--output", "json"]);
  expectExit(list, 0, "diagram list");
  assert(
    JSON.stringify(
      parseJson(list.stdout, "diagram list").data.map(({ id }) => id),
    ) === JSON.stringify(["launch-map", "release-flow"]),
    "List output was not deterministically ordered.",
  );

  const sceneDestination = resolve(fixtureRoot, "release.scene.json");
  const exportScene = await cli([
    "export",
    "release-flow",
    "--format",
    "scene",
    "--dest",
    sceneDestination,
    "--output",
    "json",
  ]);
  expectExit(exportScene, 0, "scene file export");
  parseJson(await readFile(sceneDestination), "exported scene");

  const exportExcalidraw = await cli([
    "export",
    "launch-map",
    "--format",
    "excalidraw",
    "--dest",
    "-",
    "--output",
    "json",
  ]);
  expectExit(exportExcalidraw, 0, "Excalidraw stdout export");
  parseJson(exportExcalidraw.stdout, "stdout Excalidraw artifact");
  assert(
    parseJson(exportExcalidraw.stderr, "stdout export status").ok === true,
    "Stdout export status was not isolated on stderr.",
  );

  const textShow = await cli(["show", "release-flow"]);
  expectExit(textShow, 0, "text show");
  assert(
    textShow.stdout.toString("utf8").startsWith("id: release-flow\n"),
    "Text output envelope changed.",
  );

  const bothSources = await cli([
    "create",
    "--file",
    revisedFlowPath,
    "--json",
    JSON.stringify(flowchart),
    "--output",
    "json",
  ]);
  expectExit(bothSources, 2, "mutually exclusive input sources");
  assert(
    parseJson(bothSources.stderr, "mutually exclusive input error").error
      .code === "usage_error",
    "Parser usage error was not a JSON envelope.",
  );
  const noSource = await cli(["create", "--output", "json"]);
  expectExit(noSource, 2, "missing input source");
  parseJson(noSource.stderr, "missing input source error");
  const interactiveStdin = await run(
    "script",
    ["-q", "-e", "-c", `${binary} create --file - --output json`, "/dev/null"],
    { env: cliEnvironment },
  );
  expectExit(interactiveStdin, 2, "interactive stdin rejection");
  assert(
    Buffer.concat([interactiveStdin.stdout, interactiveStdin.stderr]).includes(
      Buffer.from("interactive_stdin"),
    ),
    "Interactive stdin did not return the structured usage failure.",
  );
  const invalidDocument = await cli([
    "create",
    "--json",
    "{}",
    "--output",
    "json",
  ]);
  expectExit(invalidDocument, 3, "invalid canonical document");
  assert(
    parseJson(invalidDocument.stderr, "invalid document error").error.code ===
      "invalid_document",
    "Invalid document error code changed.",
  );
  const mismatchedEdit = await cli([
    "edit",
    "release-flow",
    "--json",
    JSON.stringify(mindmap),
    "--output",
    "json",
  ]);
  expectExit(mismatchedEdit, 3, "edit id mismatch");
  assert(
    parseJson(mismatchedEdit.stderr, "edit id mismatch error").error.code ===
      "invalid_document",
    "Edit id mismatch was not a validation failure.",
  );
  const conflict = await cli([
    "create",
    "--json",
    JSON.stringify(flowchart),
    "--output",
    "json",
  ]);
  expectExit(conflict, 6, "create conflict");
  const missing = await cli(["show", "missing-diagram", "--output", "json"]);
  expectExit(missing, 5, "missing diagram");
  const unavailablePng = await cli([
    "export",
    "release-flow",
    "--format",
    "png",
    "--dest",
    "-",
    "--output",
    "json",
  ]);
  expectExit(unavailablePng, 8, "offline unavailable PNG");
  assert(
    parseJson(unavailablePng.stderr, "unavailable PNG error").error.code ===
      "format_unavailable",
    "PNG failure was not structured.",
  );

  const record = resolve(homeRoot, ".sketchi/diagrams/release-flow");
  for (const relative of [
    "manifest.json",
    "document.json",
    "scene.json",
    "diagram.excalidraw",
    "revisions/000001.json",
  ]) {
    await readFile(resolve(record, relative));
  }
  const priorRevision = parseJson(
    await readFile(resolve(record, "revisions/000001.json")),
    "prior revision",
  );
  assert(
    priorRevision.spec.title === "Release approval",
    "Revision recovery document was not the prior canonical document.",
  );

  const summary = {
    node: process.versions.node,
    package: archives[0],
    flows: [
      "flowchart:create-show-edit-show",
      "mindmap:create-show-edit-show",
      "list",
      "export:file-stdout",
    ],
    expectedFailures: [
      "exclusive-source:2",
      "interactive-stdin:2",
      "invalid-document:3",
      "edit-id-mismatch:3",
      "not-found:5",
      "conflict:6",
      "format-unavailable:8",
      "missing-credential:9",
      "blocked-network:10",
    ],
    network: "disabled-by-preload",
    home: "isolated-under-.memory",
    bundle: {
      bytes: archivedBundle.stdout.byteLength,
      sha256: archivedBundleSha256,
    },
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
