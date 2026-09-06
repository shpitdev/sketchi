import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { CreateCanvasRequestSchema } from "@sketchi/diagram-agent";
import { assert, describe, expect, it } from "@effect/vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");
const testParent = resolve(process.cwd(), ".memory/cli-canvas-tests");

interface ProcessResult {
  readonly code: number;
  readonly stderr: Buffer;
  readonly stdout: Buffer;
}

function runCli(
  args: ReadonlyArray<string>,
  cwd: string,
  home: string,
  input?: string,
): Promise<ProcessResult> {
  return new Promise((complete, reject) => {
    const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete environment["FORCE_COLOR"];
    delete environment["NO_COLOR"];
    const child = spawn(process.execPath, [binary, ...args], {
      cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      complete({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }),
    );
    child.stdin.end(input);
  });
}

function canvasSpec(diagramId: string) {
  return {
    kind: "canvas",
    version: 1,
    diagramId,
    title: "CLI Canvas",
    width: 640,
    height: 360,
    accentColor: "#2563eb",
    backgroundColor: "#ffffff",
    elements: [
      {
        type: "node",
        id: "card",
        nodeId: "card",
        shape: "rectangle",
        x: 40,
        y: 40,
        width: 240,
        height: 120,
        label: "Universal Canvas",
      },
    ],
    layers: [],
    layouts: [],
    zOrder: ["card"],
  };
}

const excalidraw = {
  type: "excalidraw",
  version: 2,
  source: "https://sketchi.app",
  elements: [],
  appState: {},
  files: {},
};

describe("sketchi canvas command", () => {
  it("accepts a file and stdin without prompting and emits deterministic JSON", async () => {
    await mkdir(testParent, { recursive: true });
    const root = await mkdtemp(join(testParent, "run-"));
    const home = join(root, "home");
    await mkdir(home);
    const requests: ReadonlyArray<unknown>[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString());
        const decoded = CreateCanvasRequestSchema.parse(parsed);
        requests.push([decoded.spec, decoded.options]);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            ok: true,
            status: "accepted",
            buildId: `build-${decoded.spec.diagramId}`,
            normalizedSpec: decoded.spec,
            artifact: {
              artifactId: `artifact-${decoded.spec.diagramId}`,
              diagramId: decoded.spec.diagramId,
              formats: [
                { format: "scene", mimeType: "application/json" },
                {
                  format: "excalidraw",
                  mimeType: "application/json",
                  inline: excalidraw,
                },
              ],
            },
            issues: [],
          }),
        );
      });
    });

    try {
      await new Promise<void>((listening) => server.listen(0, listening));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected a TCP test server address.");
      }
      const endpoint = `http://127.0.0.1:${String(address.port)}/api/v1/canvases/create`;

      const fromFile = canvasSpec("canvas-file");
      const inputPath = join(root, "canvas.json");
      await writeFile(inputPath, JSON.stringify(fromFile));
      const fileResult = await runCli(
        [
          "canvas",
          "--file",
          inputPath,
          "--endpoint",
          endpoint,
          "--output",
          "json",
        ],
        root,
        home,
      );

      assert.strictEqual(fileResult.code, 0);
      assert.strictEqual(fileResult.stderr.toString(), "");
      expect(JSON.parse(fileResult.stdout.toString())).toMatchObject({
        ok: true,
        command: "canvas",
        data: {
          id: "canvas-file",
          type: "canvas",
          remoteArtifactId: "artifact-canvas-file",
          export: {
            format: "png",
            destination: "canvas-file.png",
          },
        },
      });
      assert.deepStrictEqual(
        [...(await readFile(join(root, "canvas-file.png"))).subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
      );
      assert.deepStrictEqual(
        JSON.parse(
          await readFile(
            join(home, ".sketchi", "diagrams", "canvas-file", "scene.json"),
            "utf8",
          ),
        ),
        fromFile,
      );

      const fromStdin = canvasSpec("canvas-stdin");
      const stdinResult = await runCli(
        [
          "canvas",
          "--file",
          "-",
          "--format",
          "excalidraw",
          "--dest",
          "-",
          "--endpoint",
          endpoint,
          "--output",
          "json",
        ],
        root,
        home,
        JSON.stringify(fromStdin),
      );

      assert.strictEqual(stdinResult.code, 0);
      assert.deepStrictEqual(
        JSON.parse(stdinResult.stdout.toString()),
        excalidraw,
      );
      expect(JSON.parse(stdinResult.stderr.toString())).toMatchObject({
        ok: true,
        command: "canvas",
        data: {
          id: "canvas-stdin",
          remoteArtifactId: "artifact-canvas-stdin",
          export: { format: "excalidraw", destination: "-" },
        },
      });
      assert.strictEqual(requests.length, 2);
    } finally {
      await new Promise<void>((closed) => server.close(() => closed()));
      await rm(root, { force: true, recursive: true });
    }
  });
});
