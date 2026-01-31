// Scenario: validate sketchi-diagram agent behavior via OpenCode serve + parquet logs.
// 1) Start serve, run sketchi-diagram; expect diagram_* tool + PNG under /sketchi.
// 2) Start serve, run sisyphus; observe tools + agents from parquet logs.
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HOST = "127.0.0.1";
const PORT_START = 4900;
const PORT_END = 4919;

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, HOST);
  });
}

async function findOpenPort(): Promise<number> {
  for (let port = PORT_START; port <= PORT_END; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No open port found in range ${PORT_START}-${PORT_END}`);
}

async function waitForServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/config`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await wait(300);
  }
  throw new Error("Timed out waiting for OpenCode server to start.");
}

async function collectProcessOutput(process: Bun.Process): Promise<string> {
  const output = await new Response(process.stdout ?? new ReadableStream()).text();
  return output.trim();
}

async function latestParquet(logDir: string): Promise<string | null> {
  if (!existsSync(logDir)) {
    return null;
  }
  const entries = await readdir(logDir);
  const parquetFiles = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".parquet"))
      .map(async (entry) => {
        const path = resolve(logDir, entry);
        const info = await stat(path);
        return { path, size: info.size, mtimeMs: info.mtimeMs };
      })
  );
  const valid = parquetFiles.filter((entry) => entry.size > 16);
  if (valid.length === 0) {
    return null;
  }
  valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return valid[0]?.path ?? null;
}

async function waitForParquet(logDir: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const path = await latestParquet(logDir);
    if (path) {
      return path;
    }
    await wait(500);
  }
  throw new Error(`No parquet file created in ${logDir}`);
}

async function runDuckDbQuery(path: string, query: string): Promise<string> {
  const duckdb = Bun.which("duckdb");
  if (!duckdb) {
    return "";
  }
  const process = Bun.spawn({
    cmd: [duckdb, "-c", query],
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(process.stdout ?? new ReadableStream()).text();
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(process.stderr ?? new ReadableStream()).text();
    throw new Error(`duckdb query failed: ${stderr.trim()}`);
  }
  return output.trim();
}

function parseEvents(output: string): Array<Record<string, unknown>> {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
}

function extractToolOutput(events: Array<Record<string, unknown>>): {
  toolName?: string;
  output?: string;
} {
  for (const event of events) {
    if (event.type === "tool_use") {
      const part = event.part as Record<string, unknown> | undefined;
      if (part?.tool && typeof part.tool === "string") {
        const state = part.state as Record<string, unknown> | undefined;
        if (state?.output && typeof state.output === "string") {
          return { toolName: part.tool, output: state.output };
        }
      }
    }
  }
  return {};
}

function extractJsonBlob(text: string): string {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return text.trim();
}

async function runScenario(options: {
  name: string;
  prompt: string;
  logDir: string;
  serveAgent: string;
}): Promise<{
  parquetPath: string;
  pngPath?: string;
  toolNames: string[];
  agents: string[];
}> {
  const port = await findOpenPort();
  const baseUrl = `http://${HOST}:${port}`;
  const serveScript = fileURLToPath(
    new URL("../scripts/opencode-serve.ts", import.meta.url)
  );
  const logRoot = resolve(process.cwd(), "sketchi");
  const logDir = resolve(logRoot, options.logDir);

  console.log(`\n[${options.name}] Starting server...`);
  const serveProcess = Bun.spawn({
    cmd: [
      "bun",
      serveScript,
      "--project-dir",
      ".",
      "--no-open",
      "--port",
      String(port),
      "--log-dir",
      options.logDir,
      "--agent",
      options.serveAgent,
    ],
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    await waitForServer(baseUrl);

    console.log(`[${options.name}] Running prompt...`);
    const runProcess = Bun.spawn({
      cmd: [
        "opencode",
        "run",
        "--attach",
        baseUrl,
        "--format",
        "json",
        options.prompt,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await collectProcessOutput(runProcess);
    const exitCode = await runProcess.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(
        runProcess.stderr ?? new ReadableStream()
      ).text();
      throw new Error(`opencode run failed: ${stderr.trim()}`);
    }

    const events = parseEvents(output);
    const toolOutput = extractToolOutput(events);
    let pngPath: string | undefined;
    if (toolOutput.output) {
      try {
        const parsed = JSON.parse(toolOutput.output) as { pngPath?: string };
        pngPath = parsed.pngPath;
      } catch {
        // ignore
      }
    }

    serveProcess.kill("SIGINT");
    await serveProcess.exited;

    const parquetPath = await waitForParquet(logDir);
    const toolNamesRaw = await runDuckDbQuery(
      parquetPath,
      `COPY (SELECT DISTINCT toolName FROM read_parquet('${parquetPath}') WHERE toolName IS NOT NULL ORDER BY toolName) TO STDOUT (FORMAT 'csv');`
    );
    const toolNames = toolNamesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== "toolName");

    const agentRaw = await runDuckDbQuery(
      parquetPath,
      `COPY (SELECT DISTINCT json_extract_string(data, '$.payload.properties.info.agent') AS agent FROM read_parquet('${parquetPath}') WHERE json_extract_string(data, '$.payload.properties.info.agent') IS NOT NULL ORDER BY agent) TO STDOUT (FORMAT 'csv');`
    );
    const agents = agentRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== "agent");

    return { parquetPath, pngPath, toolNames, agents };
  } finally {
    if (!serveProcess.killed) {
      serveProcess.kill("SIGINT");
    }
  }
}

async function run() {
  const projectDir = process.cwd();

  const diagramScenario = await runScenario({
    name: "diagram-agent",
    logDir: "opencode-logs-diagram-agent",
    serveAgent: "sketchi-diagram",
    prompt:
      "Create a simple flowchart for 'Request -> Validate -> Process -> Done'. " +
      "Use tool diagram_from_prompt. Return JSON only with fields shareUrl and pngPath.",
  });

  console.log("[diagram-agent] parquet:", diagramScenario.parquetPath);
  console.log("[diagram-agent] tools:", diagramScenario.toolNames.join(", "));
  console.log("[diagram-agent] agents:", diagramScenario.agents.join(", "));

  assert.ok(
    diagramScenario.toolNames.some((name) => name.startsWith("diagram_")),
    "Expected diagram_* tool usage in diagram-agent scenario."
  );
  if (diagramScenario.pngPath) {
    assert.ok(
      diagramScenario.pngPath.includes(`${projectDir}/sketchi/`),
      "Expected pngPath under /sketchi in project root."
    );
    assert.ok(existsSync(diagramScenario.pngPath));
  }

  const sisyphusScenario = await runScenario({
    name: "sisyphus",
    logDir: "opencode-logs-sisyphus",
    serveAgent: "sisyphus",
    prompt: "Create an Excalidraw diagram showing API -> Service -> DB.",
  });

  console.log("[sisyphus] parquet:", sisyphusScenario.parquetPath);
  console.log("[sisyphus] tools:", sisyphusScenario.toolNames.join(", "));
  console.log("[sisyphus] agents:", sisyphusScenario.agents.join(", "));

  assert.ok(
    sisyphusScenario.toolNames.some((name) => name.startsWith("diagram_")),
    "Expected diagram_* tool usage in sisyphus scenario."
  );

  console.log("Diagram agent behavior test complete.");
}

run().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
