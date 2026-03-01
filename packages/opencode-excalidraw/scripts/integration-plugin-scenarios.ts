// Scenario:
// 1) diagram_from_prompt -> expect shareLink + PNG under ./sketchi/png
// 2) diagram_tweak (same session + request) -> expect same session continuity + PNG
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

const SKIP_PNG_RENDER = process.env.SKETCHI_SKIP_PNG_RENDER === "1";

async function assertPngPath(path: string) {
  if (SKIP_PNG_RENDER) {
    return;
  }
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

type DiagramFromPromptTool = NonNullable<
  Awaited<ReturnType<typeof SketchiPlugin>>["tool"]
>["diagram_from_prompt"];
type DiagramTweakTool = NonNullable<
  Awaited<ReturnType<typeof SketchiPlugin>>["tool"]
>["diagram_tweak"];
type DiagramToPngTool = NonNullable<
  Awaited<ReturnType<typeof SketchiPlugin>>["tool"]
>["diagram_to_png"];

interface GenerateResult {
  pngPath?: string;
  pngSkipped?: boolean;
  sessionId: string;
  shareLink: { url: string };
  studioUrl: string;
}

interface TweakResult {
  pngPath?: string;
  pngSkipped?: boolean;
  sessionId: string;
  shareLink: { url: string };
  studioUrl: string;
}

function requireTool<T>(tool: T | undefined, name: string): T {
  if (!tool) {
    throw new Error(`${name} tool missing`);
  }
  return tool;
}

async function runGenerateScenario(
  fromPrompt: DiagramFromPromptTool,
  context: ToolContext
): Promise<GenerateResult> {
  console.log("Scenario 1: diagram_from_prompt");
  const generateRaw = await fromPrompt.execute(
    { prompt: "Create a two-step flowchart: Start -> End." },
    context
  );
  const generate = JSON.parse(generateRaw) as GenerateResult;

  if (!generate.sessionId) {
    throw new Error("diagram_from_prompt did not return sessionId");
  }
  if (!generate.studioUrl?.includes(`/diagrams/${generate.sessionId}`)) {
    throw new Error("diagram_from_prompt did not return matching studioUrl");
  }
  if (!generate.shareLink?.url?.includes("https://excalidraw.com/#json=")) {
    throw new Error("diagram_from_prompt did not return Excalidraw share link");
  }
  if (!SKIP_PNG_RENDER) {
    if (!generate.pngPath) {
      throw new Error("diagram_from_prompt missing pngPath");
    }
    await assertPngPath(generate.pngPath);
  }

  return generate;
}

async function runTweakScenario(
  tweak: DiagramTweakTool,
  context: ToolContext,
  generate: GenerateResult
): Promise<TweakResult> {
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
            sessionId: generate.sessionId,
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

  const tweaked = JSON.parse(tweakRaw) as TweakResult;
  if (tweaked.sessionId !== generate.sessionId) {
    throw new Error(
      `Expected tweak to stay on session ${generate.sessionId}, got ${tweaked.sessionId}`
    );
  }
  if (!tweaked.studioUrl?.includes(`/diagrams/${generate.sessionId}`)) {
    throw new Error("diagram_tweak did not return matching studioUrl");
  }
  if (!tweaked.shareLink?.url?.includes("https://excalidraw.com/#json=")) {
    throw new Error("diagram_tweak did not return Excalidraw share link");
  }
  if (!SKIP_PNG_RENDER) {
    if (!tweaked.pngPath) {
      throw new Error("diagram_tweak missing pngPath");
    }
    await assertPngPath(tweaked.pngPath);
  }

  return tweaked;
}

async function runToPngScenario(
  toPng: DiagramToPngTool,
  context: ToolContext,
  tweaked: TweakResult
) {
  if (SKIP_PNG_RENDER) {
    console.log(
      "Scenario 3: diagram_to_png (skipped via SKETCHI_SKIP_PNG_RENDER=1)"
    );
    return;
  }

  console.log("Scenario 3: diagram_to_png");
  const toPngRaw = await toPng.execute(
    { shareUrl: tweaked.shareLink.url },
    context
  );
  const toPngResult = JSON.parse(toPngRaw) as { pngPath: string };
  await assertPngPath(toPngResult.pngPath);
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

  const fromPrompt = requireTool(
    tools.diagram_from_prompt,
    "diagram_from_prompt"
  );
  const tweak = requireTool(tools.diagram_tweak, "diagram_tweak");
  const toPng = requireTool(tools.diagram_to_png, "diagram_to_png");

  const generate = await runGenerateScenario(fromPrompt, context);
  console.log(`  continuity.sessionId=${generate.sessionId}`);
  console.log(`  continuity.studioUrl=${generate.studioUrl}`);
  const tweaked = await runTweakScenario(tweak, context, generate);
  console.log(`  continuity.tweakSessionId=${tweaked.sessionId}`);
  await runToPngScenario(toPng, context, tweaked);

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
