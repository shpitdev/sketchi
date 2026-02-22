// Scenario:
// 1) diagram_from_prompt -> expect shareLink + PNG under ./sketchi/png
// 2) diagram_tweak (shareUrl + request) -> expect new shareLink + PNG
// 3) diagram_to_png (shareUrl) -> expect PNG under ./sketchi/png
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import SketchiPlugin from "../src/index";

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
    metadata: () => undefined,
    ask: async () => undefined,
  };
}

async function assertPngPath(path: string) {
  const pngRoot = resolve(process.cwd(), "sketchi", "png");
  const normalized = resolve(path);
  if (!normalized.startsWith(pngRoot)) {
    throw new Error(`PNG path must stay under ${pngRoot}: ${normalized}`);
  }
  if (!existsSync(normalized)) {
    throw new Error(`Expected PNG file to exist at ${normalized}`);
  }
  const info = await stat(normalized);
  if (info.size <= 0) {
    throw new Error(`Expected non-empty PNG at ${normalized}`);
  }
}

function wait(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
  const tweak = tools.diagram_tweak;
  const toPng = tools.diagram_to_png;

  if (!fromPrompt) {
    throw new Error("diagram_from_prompt tool missing");
  }
  if (!tweak) {
    throw new Error("diagram_tweak tool missing");
  }
  if (!toPng) {
    throw new Error("diagram_to_png tool missing");
  }

  console.log("Scenario 1: diagram_from_prompt");
  const generateRaw = await fromPrompt.execute(
    { prompt: "Create a two-step flowchart: Start -> End." },
    context
  );
  const generate = JSON.parse(generateRaw) as {
    shareLink: { url: string };
    pngPath: string;
  };
  if (!generate.shareLink?.url?.includes("https://excalidraw.com/#json=")) {
    throw new Error("diagram_from_prompt did not return Excalidraw share link");
  }
  await assertPngPath(generate.pngPath);

  console.log("Scenario 2: diagram_tweak");
  let tweakRaw: string | undefined;
  let tweakError: unknown;
  const tweakRequests = [
    {
      request: "Rename 'End' to 'Finish'.",
      options: { timeoutMs: 60_000, maxSteps: 3 },
    },
    {
      request: "Change the label colors for better contrast.",
      options: { timeoutMs: 60_000, maxSteps: 2 },
    },
  ];

  for (const payload of tweakRequests) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        tweakRaw = await tweak.execute(
          {
            shareUrl: generate.shareLink.url,
            ...payload,
          },
          context
        );
        tweakError = undefined;
        break;
      } catch (error) {
        tweakError = error;
        await wait(1000 * attempt);
      }
    }
    if (tweakRaw) {
      break;
    }
  }
  if (!tweakRaw) {
    throw tweakError;
  }

  const tweaked = JSON.parse(tweakRaw) as {
    shareLink: { url: string };
    pngPath: string;
  };
  if (!tweaked.shareLink?.url?.includes("https://excalidraw.com/#json=")) {
    throw new Error("diagram_tweak did not return Excalidraw share link");
  }
  await assertPngPath(tweaked.pngPath);

  console.log("Scenario 3: diagram_to_png");
  const toPngRaw = await toPng.execute(
    { shareUrl: tweaked.shareLink.url },
    context
  );
  const toPngResult = JSON.parse(toPngRaw) as { pngPath: string };
  await assertPngPath(toPngResult.pngPath);

  console.log("All plugin scenarios passed.");

  if (tools.diagram_grade) {
    console.log(
      "Scenario 4: diagram_grade (skipped - requires OpenCode session)"
    );
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
