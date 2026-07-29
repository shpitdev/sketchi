import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";

const workspaceRoot = resolve(process.cwd());

async function sourceFiles(directory: string): Promise<ReadonlyArray<string>> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await sourceFiles(path)));
    else if (
      entry.isFile() &&
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts")
    )
      output.push(path);
  }
  return output;
}

describe("CLI dependency and public-surface audit", () => {
  it("pins the exact Effect v4 beta dependencies without alternate CLI frameworks", async () => {
    const manifest = JSON.parse(
      await readFile(join(workspaceRoot, "apps/cli/package.json"), "utf8"),
    );

    assert.strictEqual(manifest.dependencies.effect, "4.0.0-beta.99");
    assert.strictEqual(
      manifest.dependencies["@effect/platform-node"],
      "4.0.0-beta.99",
    );
    assert.strictEqual(
      manifest.dependencies["@sketchi/diagram-agent"],
      "workspace:*",
    );
    assert.strictEqual(manifest.dependencies.linkedom, "0.18.13");
    assert.notProperty(manifest.dependencies, "jsdom");
    assert.notProperty(manifest.dependencies, "@sketchi/diagram-generation");
    assert.notProperty(manifest.dependencies, "@ai-sdk/google");
    assert.notProperty(manifest.dependencies, "ai");
    assert.notProperty(manifest.dependencies, "oclif");
    assert.notProperty(manifest.dependencies, "ink");
    assert.deepStrictEqual(Object.keys(manifest.bin), ["sketchi"]);
  });

  it("isolates the sole unstable CLI import behind the internal adapter", async () => {
    const files = await sourceFiles(join(workspaceRoot, "apps/cli/src"));
    const directImports: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (/from\s+["']effect\/unstable\/cli["']/u.test(text))
        directImports.push(file);
    }

    assert.deepStrictEqual(
      directImports.map((file) => file.slice(workspaceRoot.length + 1)),
      ["apps/cli/src/internal/effect-unstable-cli.ts"],
    );
  });

  it("uses package Effect codecs as the sole canonical document authority", async () => {
    const files = await sourceFiles(join(workspaceRoot, "apps/cli/src"));
    const source = (
      await Promise.all(files.map((file) => readFile(file, "utf8")))
    ).join("\n");
    const adapter = await readFile(
      join(workspaceRoot, "apps/cli/src/document.ts"),
      "utf8",
    );

    assert.notInclude(source, "CanonicalDiagramDocumentSchema");
    assert.notMatch(source, /from\s+["']zod["']/u);
    assert.include(adapter, "Schema.decodeUnknownEffect(FlowchartSpec");
    assert.include(adapter, "Schema.decodeUnknownEffect(MindmapSpec");
    assert.notInclude(adapter, "Schema.Struct");
    assert.notInclude(adapter, "Schema.Union");
    assert.notInclude(source, "NormalizedFlowchartSchema");
    assert.notInclude(source, "NormalizedMindmapSchema");
  });

  it("confines network boundaries to the three credential-free HTTPS commands", async () => {
    const files = await sourceFiles(join(workspaceRoot, "apps/cli/src"));
    const fetchFiles: string[] = [];
    let cliSource = "";
    for (const file of files) {
      const text = await readFile(file, "utf8");
      cliSource += `${text}\n`;
      if (/(?:globalThis\.)?fetch\s*\(/u.test(text)) fetchFiles.push(file);
      assert.notInclude(text, "CloudflareAiGateway");
      assert.notInclude(text, "Mcp");
    }
    assert.deepStrictEqual(
      fetchFiles.map((file) => file.slice(workspaceRoot.length + 1)),
      ["apps/cli/src/generation.ts", "apps/cli/src/share.ts"],
    );
    assert.notInclude(cliSource, "GOOGLE_GENERATIVE_AI_API_KEY");
    assert.notInclude(cliSource, "CF_AIG_TOKEN");
    assert.notInclude(cliSource, "cf-aig-authorization");
    assert.notInclude(cliSource, "gateway.ai.cloudflare.com");

    const generationSource = await readFile(
      join(workspaceRoot, "apps/cli/src/generation.ts"),
      "utf8",
    );
    assert.include(
      generationSource,
      "https://playground.sketchi.app/api/v1/generate",
    );
    assert.notInclude(generationSource, "@sketchi/diagram-generation");

    const shareProtocolSource = await readFile(
      join(workspaceRoot, "apps/cli/src/share-protocol.ts"),
      "utf8",
    );
    assert.include(
      shareProtocolSource,
      "https://json.excalidraw.com/api/v2/post/",
    );
    assert.include(shareProtocolSource, "https://json.excalidraw.com/api/v2/");

    const providerManifest = JSON.parse(
      await readFile(
        join(workspaceRoot, "packages/diagram/generation/package.json"),
        "utf8",
      ),
    );
    assert.notProperty(providerManifest.dependencies, "@ai-sdk/google");
    assert.notProperty(providerManifest.dependencies, "ai");
  });

  it("publishes the explicit offline and network top-level commands", async () => {
    const help = await readFile(
      join(workspaceRoot, "apps/cli/src/__fixtures__/help/root.txt"),
      "utf8",
    );
    const section = help.split("SUBCOMMANDS\n")[1] ?? "";
    const commands = section
      .split("\n")
      .filter((line) => /^  [a-z]/u.test(line))
      .map((line) => line.trim().split(/\s+/u)[0]);

    assert.deepStrictEqual(commands, [
      "generate",
      "docs",
      "create",
      "show",
      "edit",
      "patch",
      "list",
      "restore",
      "share",
      "pull",
      "export",
    ]);
    for (const forbidden of [
      "auth",
      "config",
      "completion",
      "mcp",
      "eval",
      "scenario",
      "delete",
      "tui",
    ]) {
      assert.notInclude(commands, forbidden);
    }
  });

  it("emits a self-contained executable package with lazy local renderer code", async () => {
    const manifest = JSON.parse(
      await readFile(join(workspaceRoot, "apps/cli/dist/package.json"), "utf8"),
    );
    const bundle = await readFile(
      join(workspaceRoot, "apps/cli/dist/sketchi.js"),
      "utf8",
    );
    const readme = await readFile(
      join(workspaceRoot, "apps/cli/dist/README.md"),
      "utf8",
    );

    assert.strictEqual(manifest.name, "sketchi");
    assert.deepStrictEqual(manifest.bin, { sketchi: "./sketchi.js" });
    assert.deepStrictEqual(manifest.files, [
      "sketchi.js",
      "chunks",
      "README.md",
      "THIRD_PARTY_NOTICES",
    ]);
    assert.deepStrictEqual(manifest.publishConfig, { access: "public" });
    assert.strictEqual(manifest.license, "MIT");
    assert.strictEqual(manifest.thirdPartyNotices, "THIRD_PARTY_NOTICES");
    assert.notProperty(manifest, "dependencies");
    assert.match(bundle.slice(0, 64), /^#!\/usr\/bin\/env node/u);
    assert.notInclude(bundle, "sourceMappingURL");
    assert.notInclude(bundle, "CF_AIG_TOKEN");
    assert.include(bundle, "playground.sketchi.app/api/v1/generate");
    assert.include(readme, "Typed, deterministic diagrams from your terminal.");
    assert.include(readme, "npm install -g sketchi");
  });
});
