// @vitest-environment node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const workerConfig = resolve(
  process.cwd(),
  "dist/apps/icons/server/wrangler.json",
);

let origin = "";
let worker: ChildProcessWithoutNullStreams | undefined;
let workerOutput = "";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local Worker port.");
  }
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitForWorker(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker?.exitCode !== null) {
      throw new Error(`Local Worker exited early.\n${workerOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for local Worker.\n${workerOutput}`);
}

describe("built icons Worker", () => {
  beforeAll(async () => {
    const port = await availablePort();
    origin = `http://127.0.0.1:${port}`;
    worker = spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "dev",
        "--config",
        workerConfig,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      { cwd: process.cwd(), env: process.env },
    );
    worker.stdout.on("data", (chunk: Buffer) => {
      workerOutput += chunk.toString();
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      workerOutput += chunk.toString();
    });
    await waitForWorker(`${origin}/api/icons?q=k8s&limit=1`);
  }, 35_000);

  afterAll(async () => {
    if (!worker || worker.exitCode !== null) return;
    worker.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveExit) =>
        worker?.once("exit", () => resolveExit()),
      ),
      new Promise<void>((resolveWait) => setTimeout(resolveWait, 5_000)),
    ]);
    if (worker.exitCode === null) worker.kill("SIGKILL");
  });

  it("serves detail, raw SVG, HEAD, and CORS through the assets binding", async () => {
    const detail = await fetch(`${origin}/api/icons/kubernetes`);
    expect(detail.status).toBe(200);
    expect(detail.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(detail.json()).resolves.toMatchObject({
      name: "Kubernetes",
      slug: "kubernetes",
      svg: expect.stringContaining("<svg"),
    });

    const raw = await fetch(`${origin}/api/icons/react.svg`);
    expect(raw.status).toBe(200);
    expect(raw.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(raw.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(raw.text()).resolves.toContain("<svg");

    const head = await fetch(`${origin}/api/icons/react.svg`, {
      method: "HEAD",
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await head.text()).toBe("");

    const options = await fetch(`${origin}/api/icons/react.svg`, {
      method: "OPTIONS",
    });
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(options.headers.get("Access-Control-Allow-Methods")).toContain(
      "HEAD",
    );
  });

  it("loads raw SVG through MCP get_icon in the built Worker", async () => {
    const client = new Client({ name: "worker-smoke", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${origin}/mcp`),
    );
    try {
      await client.connect(transport as Parameters<Client["connect"]>[0]);
      const result = await client.callTool({
        arguments: { slug: "kubernetes" },
        name: "get_icon",
      });
      const content = Array.isArray(result.content) ? result.content : [];
      expect(content[0]).toMatchObject({
        text: expect.stringContaining("<svg"),
        type: "text",
      });
      expect(result.structuredContent).toMatchObject({ slug: "kubernetes" });
    } finally {
      await client.close();
    }
  });
});
