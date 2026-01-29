// Scenario: run OpenCode end-to-end, verify tool usage and parquet logging.
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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
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
  const parquetFiles = entries
    .filter((entry) => entry.endsWith(".parquet"))
    .map((entry) => resolve(logDir, entry));
  if (parquetFiles.length === 0) {
    return null;
  }
  const stats = await Promise.all(
    parquetFiles.map(async (path) => ({ path, info: await stat(path) }))
  );
  stats.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  return stats[0]?.path ?? null;
}

async function waitForParquet(logDir: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const path = await latestParquet(logDir);
    if (path) {
      return path;
    }
    await wait(500);
  }
  throw new Error(`No parquet file created in ${logDir}`);
}

async function parquetHasTool(
  path: string,
  toolName: string
): Promise<boolean> {
  const duckdb = Bun.which("duckdb");
  if (!duckdb) {
    console.log("duckdb not found; skipping parquet content check.");
    return true;
  }
  const query = `COPY (SELECT COUNT(*) AS n FROM read_parquet('${path}') WHERE toolName='${toolName}') TO STDOUT (FORMAT 'csv');`;
  const process = Bun.spawn({
    cmd: [duckdb, "-c", query],
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(
    process.stdout ?? new ReadableStream()
  ).text();
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(
      process.stderr ?? new ReadableStream()
    ).text();
    throw new Error(`duckdb query failed: ${stderr.trim()}`);
  }
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const countLine = lines.at(-1) ?? "0";
  const count = Number.parseInt(countLine, 10);
  return count > 0;
}

async function run() {
  const logDir = resolve(process.cwd(), "sketchi", "opencode-logs");
  const port = await findOpenPort();
  const baseUrl = `http://${HOST}:${port}`;
  const serveScript = fileURLToPath(
    new URL("../scripts/opencode-serve.ts", import.meta.url)
  );

  console.log("Starting OpenCode server...");
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
      "opencode-logs",
    ],
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    await waitForServer(baseUrl);

    console.log("Running OpenCode prompt...");
    const prompt =
      "Use tool diagram_from_prompt to create a simple flowchart. " +
      "Return JSON only with fields shareUrl and pngPath (shareUrl should be shareLink.url).";
    const runProcess = Bun.spawn({
      cmd: ["opencode", "run", "--attach", baseUrl, "--format", "json", prompt],
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

    const events = output
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

    let toolCalled = false;
    let toolOutput: { shareLink?: { url?: string }; pngPath?: string } | null =
      null;
    const textParts = new Map<string, string>();

    for (const event of events) {
      if (event.type === "tool_use") {
        const part = event.part as Record<string, unknown> | undefined;
        if (part?.tool === "diagram_from_prompt") {
          toolCalled = true;
          const state = part.state as Record<string, unknown> | undefined;
          if (state?.output && typeof state.output === "string") {
            try {
              toolOutput = JSON.parse(state.output) as {
                shareLink?: { url?: string };
                pngPath?: string;
              };
            } catch {
              // ignore
            }
          }
        }
      }
      if (event.type === "text") {
        const part = event.part as Record<string, unknown> | undefined;
        if (part && typeof part.id === "string" && typeof part.text === "string") {
          textParts.set(part.id, part.text);
        }
      }
    }

    assert.ok(toolCalled, "Expected diagram_from_prompt tool call in events.");

    const extractJson = (text: string): string => {
      const match = text.match(/```json\\s*([\\s\\S]*?)```/);
      if (match?.[1]) {
        return match[1].trim();
      }
      return text.trim();
    };

    let parsedOutput: { shareUrl?: string; pngPath?: string } | null = null;
    for (const text of textParts.values()) {
      try {
        const parsed = JSON.parse(extractJson(text)) as {
          shareUrl?: string;
          pngPath?: string;
        };
        if (parsed?.shareUrl && parsed?.pngPath) {
          parsedOutput = parsed;
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!parsedOutput && toolOutput?.shareLink?.url && toolOutput?.pngPath) {
      parsedOutput = {
        shareUrl: toolOutput.shareLink.url,
        pngPath: toolOutput.pngPath,
      };
    }

    assert.ok(parsedOutput, "Expected JSON output with shareUrl and pngPath.");
    assert.ok(parsedOutput?.shareUrl?.startsWith("https://excalidraw.com/#"));
    assert.ok(parsedOutput?.pngPath);
    assert.ok(existsSync(parsedOutput?.pngPath ?? ""));

    serveProcess.kill("SIGINT");
    await serveProcess.exited;

    const parquetPath = await waitForParquet(logDir);
    const info = await stat(parquetPath);
    assert.ok(info.size > 0, "Parquet file is empty.");
    const hasTool = await parquetHasTool(parquetPath, "diagram_from_prompt");
    assert.ok(hasTool, "Parquet missing diagram_from_prompt tool row.");

    console.log("OpenCode E2E test passed.");
  } finally {
    if (!serveProcess.killed) {
      serveProcess.kill("SIGINT");
    }
  }
}

run().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
