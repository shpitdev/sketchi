import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

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
  assert(
    bounds.maxX <= bounds.width - minimumPadding - 1,
    `${label} clips ink at the right edge.`,
  );
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
const wideTitleFlowchart = {
  ...flowchart,
  spec: {
    ...flowchart.spec,
    id: "wide-title",
    title: "W".repeat(40),
  },
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
  const packagedFiles = await run("tar", ["-tzf", archive]);
  expectExit(packagedFiles, 0, "list packaged CLI files");
  const packagedFileNames = packagedFiles.stdout
    .toString("utf8")
    .trim()
    .split("\n")
    .sort();
  const bundleReport = parseJson(
    await readFile(bundleReportPath),
    "CLI bundle report",
  );
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
    const archivedFile = await run("tar", [
      "-xOf",
      archive,
      `package/${file.path}`,
    ]);
    expectExit(archivedFile, 0, `read packaged CLI file ${file.path}`);
    archivedBundleBytes += archivedFile.stdout.byteLength;
    archivedBundleHash.update(file.path);
    archivedBundleHash.update("\0");
    archivedBundleHash.update(archivedFile.stdout);
    assert(
      createHash("sha256").update(archivedFile.stdout).digest("hex") ===
        file.sha256,
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
  const archivedReadme = await run("tar", [
    "-xOf",
    archive,
    "package/README.md",
  ]);
  expectExit(archivedReadme, 0, "read packaged CLI README");
  const sourceReadme = await readFile(
    resolve(workspaceRoot, "apps/cli/README.md"),
  );
  assert(
    archivedReadme.stdout.equals(sourceReadme),
    "Packaged CLI README does not match apps/cli/README.md.",
  );
  const archivedNotices = await run("tar", [
    "-xOf",
    archive,
    "package/THIRD_PARTY_NOTICES",
  ]);
  expectExit(archivedNotices, 0, "read packaged third-party notices");
  assert(
    archivedNotices.stdout.includes(
      Buffer.from("Mozilla Public License 2.0"),
    ) &&
      archivedNotices.stdout.includes(Buffer.from("SIL OPEN FONT LICENSE")) &&
      archivedNotices.stdout.includes(Buffer.from("MIT License")) &&
      archivedNotices.stdout.includes(Buffer.from("linkedom 0.18.13")) &&
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
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS ?? ""} --require=${preload}`.trim(),
  };
  delete cliEnvironment.NO_COLOR;
  delete cliEnvironment.FORCE_COLOR;
  delete cliEnvironment.SKETCHI_GENERATE_ENDPOINT;
  const cli = (args, input) =>
    run(binary, args, { env: cliEnvironment, input });

  // Online environment for the generate endpoint-error proof only: the offline
  // matrix stays network-blocked; generate is deliberately excepted so its
  // typed endpoint-error failure can be exercised against a loopback server.
  const onlineEnvironment = { ...cliEnvironment };
  delete onlineEnvironment.NODE_OPTIONS;

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
    bashCompletions.stdout
      .toString("utf8")
      .startsWith("###-begin-sketchi-completions-###\n"),
    "Built CLI did not emit the expected bash completion script.",
  );
  assert(
    bashCompletions.stdout.includes(
      Buffer.from("complete -F _sketchi sketchi"),
    ),
    "Bash completion script did not register the sketchi completer.",
  );

  // Network-down: the offline preload blocks fetch, so the sole HTTPS call fails
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
    parseJson(networkDown.stderr, "generate network-down").error.code ===
      "provider_failure",
    "Generate network-down did not use the stable error code.",
  );

  // Endpoint-error: a loopback generate API returns a typed rejection; the CLI
  // maps it to a stable exit and still writes no partial local state.
  const endpointServer = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          status: "invalid_generated_document",
          issues: [
            {
              code: "invalid_generated_document",
              severity: "error",
              stage: "generation",
              message: "The generated diagram failed validation.",
              hint: "Refine the prompt with concrete content, then retry.",
            },
          ],
        }),
      );
    });
  });
  await new Promise((ready) => endpointServer.listen(0, "127.0.0.1", ready));
  const endpointPort = endpointServer.address().port;
  let endpointError;
  try {
    endpointError = await run(
      binary,
      [
        "generate",
        "--prompt",
        "Create a two-step release flow.",
        "--endpoint",
        `http://127.0.0.1:${String(endpointPort)}/api/v1/generate`,
        "--output",
        "json",
      ],
      { env: onlineEnvironment },
    );
  } finally {
    await new Promise((closed) => endpointServer.close(closed));
  }
  expectExit(endpointError, 3, "generate endpoint-error");
  assert(
    parseJson(endpointError.stderr, "generate endpoint-error").error.code ===
      "invalid_generated_document",
    "Generate endpoint-error did not use the stable error code.",
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
  assert(
    exportScene.stdout.byteLength === 0,
    "File export wrote status to stdout.",
  );
  assert(
    parseJson(exportScene.stderr, "scene file export status").ok === true,
    "File export status was not isolated on stderr.",
  );

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
  assert(
    exportPng.stdout.byteLength === 0,
    "PNG file export contaminated stdout.",
  );
  assert(
    exportPng.stderr.includes(
      Buffer.from(
        `hint: to show this diagram to the user, display the exported file as an inline markdown image, e.g. ![release-flow](<${pngDestination}>)`,
      ),
    ),
    "PNG file export omitted the agent display hint.",
  );
  const firstPng = await readFile(pngDestination);
  assert(
    firstPng
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "PNG file export did not write a PNG signature.",
  );
  assertInkHasPadding(firstPng, "PNG file export");

  const newlineDestination = resolve(
    fixtureRoot,
    "release\n\u0085\u2028\u2029flow.png",
  );
  const newlineExport = await cli([
    "export",
    "release-flow",
    "--format",
    "png",
    "--dest",
    newlineDestination,
    "--output",
    "json",
  ]);
  expectExit(newlineExport, 0, "newline-path PNG export");
  const newlineHint = parseJson(
    newlineExport.stderr,
    "newline-path PNG export status",
  ).data.hint;
  assert(
    !/[\n\u0085\u2028\u2029]/u.test(newlineHint) &&
      ["%0A", "%C2%85", "%E2%80%A8", "%E2%80%A9"].every((encoded) =>
        newlineHint.includes(encoded),
      ),
    "PNG display hint did not preserve its one-line contract.",
  );

  const createWideTitle = await cli([
    "create",
    "--json",
    JSON.stringify(wideTitleFlowchart),
    "--output",
    "json",
  ]);
  expectExit(createWideTitle, 0, "wide-title flowchart create");
  const wideTitleDestination = resolve(fixtureRoot, "wide-title.png");
  const exportWideTitle = await cli([
    "export",
    "wide-title",
    "--format",
    "png",
    "--dest",
    wideTitleDestination,
  ]);
  expectExit(exportWideTitle, 0, "wide-title PNG export");
  const wideTitlePng = await readFile(wideTitleDestination);
  assertInkHasPadding(wideTitlePng, "wide-title PNG export");
  assert(
    inkBounds(wideTitlePng).width > inkBounds(firstPng).width,
    "Wide-title PNG did not grow its canvas to the measured font bounds.",
  );

  const record = resolve(homeRoot, ".sketchi/diagrams/release-flow");
  const insideRecord = await cli([
    "export",
    "release-flow",
    "--format",
    "png",
    "--dest",
    resolve(record, "diagram.png"),
    "--output",
    "json",
  ]);
  expectExit(insideRecord, 8, "inside-record PNG destination rejection");
  assert(
    parseJson(insideRecord.stderr, "inside-record destination error").error
      .code === "invalid_destination",
    "Inside-record destination did not use the typed destination error.",
  );
  const storageAlias = resolve(fixtureRoot, "diagram-storage-alias");
  await symlink(resolve(homeRoot, ".sketchi/diagrams"), storageAlias, "dir");
  const aliasedRecord = await cli([
    "export",
    "release-flow",
    "--format",
    "png",
    "--dest",
    resolve(storageAlias, "release-flow/diagram.png"),
    "--output",
    "json",
  ]);
  expectExit(aliasedRecord, 8, "aliased-record PNG destination rejection");
  assert(
    parseJson(aliasedRecord.stderr, "aliased-record destination error").error
      .code === "invalid_destination",
    "Aliased record destination did not use the typed destination error.",
  );

  const repeatedPngDestination = resolve(
    fixtureRoot,
    "release-flow-repeat.png",
  );
  const repeatedPng = await cli([
    "export",
    "release-flow",
    "--format",
    "png",
    "--dest",
    repeatedPngDestination,
    "--output",
    "json",
  ]);
  expectExit(repeatedPng, 0, "repeated PNG file export");
  const repeatedPngStatus = parseJson(
    repeatedPng.stderr,
    "repeated PNG file export status",
  );
  assert(
    repeatedPngStatus.data.hint.includes("![release-flow]"),
    "JSON PNG status omitted the agent display hint.",
  );
  assert(
    firstPng.equals(await readFile(repeatedPngDestination)),
    "Repeated PNG exports were not byte-identical.",
  );

  const stdoutPng = await cli([
    "export",
    "launch-map",
    "--format",
    "png",
    "--dest",
    "-",
    "--output",
    "json",
  ]);
  expectExit(stdoutPng, 0, "PNG stdout export");
  assert(
    stdoutPng.stdout
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "PNG stdout export did not keep stdout byte-only.",
  );
  const stdoutPngStatus = parseJson(stdoutPng.stderr, "PNG stdout status");
  assert(
    !("hint" in stdoutPngStatus.data),
    "PNG stdout export emitted a file-only display hint.",
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
  for (const relative of [
    "manifest.json",
    "document.json",
    "scene.json",
    "diagram.excalidraw",
    "revisions/000001.json",
  ]) {
    await readFile(resolve(record, relative));
  }
  const recordEntries = await readdir(record);
  assert(
    !recordEntries.includes("diagram.png"),
    "On-demand PNG export wrote back to the diagram record.",
  );
  assert(
    JSON.stringify(
      parseJson(await readFile(resolve(record, "manifest.json")), "manifest")
        .formats,
    ) === JSON.stringify(["scene", "excalidraw"]),
    "On-demand PNG export changed manifest formats.",
  );
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
      "export:file-stdout-png-on-demand",
    ],
    expectedFailures: [
      "exclusive-source:2",
      "interactive-stdin:2",
      "invalid-document:3",
      "edit-id-mismatch:3",
      "not-found:5",
      "conflict:6",
      "generate-network-down:10",
      "generate-endpoint-error:3",
    ],
    network: "disabled-by-preload-except-generate-loopback-proof",
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
