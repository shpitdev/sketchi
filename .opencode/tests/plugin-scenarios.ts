// Scenarios:
// 1) diagram_from_prompt -> expect shareLink + PNG under ./sketchi/png
// 2) diagram_modify (shareUrl + request) -> expect new shareLink + PNG
// 3) diagram_to_png (shareUrl) -> expect PNG under ./sketchi/png
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import SketchiPlugin from "../plugins/sketchi/index";

type ToolContext = Parameters<
  NonNullable<
    Awaited<ReturnType<typeof SketchiPlugin>>["tool"]
  >["diagram_to_png"]["execute"]
>[1];

function createContext(): ToolContext {
  const directory = resolve(process.cwd());
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  };
}

async function assertPngPath(path: string) {
  const pngRoot = resolve(process.cwd(), "sketchi", "png");
  const normalized = resolve(path);
  assert.ok(normalized.startsWith(pngRoot));
  assert.ok(existsSync(normalized));
  const info = await stat(normalized);
  assert.ok(info.size > 0);
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const directory = resolve(process.cwd());
  const plugin = await SketchiPlugin({
    client: {} as never,
    project: { id: "test", name: "test", root: directory } as never,
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:0"),
    $: {} as never,
  });
  const tools = plugin.tool ?? {};
  const context = createContext();

  const fromPrompt = tools.diagram_from_prompt;
  const modify = tools.diagram_modify;
  const toPng = tools.diagram_to_png;

  assert.ok(fromPrompt, "diagram_from_prompt tool missing");
  assert.ok(modify, "diagram_modify tool missing");
  assert.ok(toPng, "diagram_to_png tool missing");

  console.log("Scenario 1: diagram_from_prompt");
  const generateRaw = await fromPrompt.execute(
    { prompt: "Create a two-step flowchart: Start -> End." },
    context
  );
  const generate = JSON.parse(generateRaw) as {
    shareLink: { url: string };
    pngPath: string;
  };
  assert.ok(generate.shareLink?.url?.includes("https://excalidraw.com/#json="));
  await assertPngPath(generate.pngPath);

  console.log("Scenario 2: diagram_modify");
  let modifyRaw: string | undefined;
  let modifyError: unknown;
  const modifyRequests = [
    {
      request: "Add a node labeled 'QA' connected from 'End'.",
      options: { timeoutMs: 60000, maxSteps: 3 },
    },
    {
      request: "Rename 'End' to 'Finish'.",
      options: { timeoutMs: 60000, maxSteps: 2 },
    },
  ];

  for (const payload of modifyRequests) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        modifyRaw = await modify.execute(
          {
            shareUrl: generate.shareLink.url,
            ...payload,
          },
          context
        );
        modifyError = undefined;
        break;
      } catch (error) {
        modifyError = error;
        await wait(1000 * attempt);
      }
    }
    if (modifyRaw) {
      break;
    }
  }
  if (!modifyRaw) {
    throw modifyError;
  }
  const modified = JSON.parse(modifyRaw) as {
    shareLink: { url: string };
    pngPath: string;
  };
  assert.ok(modified.shareLink?.url?.includes("https://excalidraw.com/#json="));
  await assertPngPath(modified.pngPath);

  console.log("Scenario 3: diagram_to_png");
  const toPngRaw = await toPng.execute(
    { shareUrl: modified.shareLink.url },
    context
  );
  const toPngResult = JSON.parse(toPngRaw) as { pngPath: string };
  await assertPngPath(toPngResult.pngPath);

  console.log("All plugin scenarios passed.");

  if (tools.diagram_grade) {
    console.log("Scenario 4: diagram_grade (skipped - requires OpenCode session)");
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
