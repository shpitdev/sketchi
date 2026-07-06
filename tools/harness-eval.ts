import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateScenarioDiagram,
  flowchartScenarios,
  getScenario,
  type DiagramScenario,
  type ScenarioEvaluation,
} from "@sketchi/diagram-scenarios";

type HarnessName = "antigravity" | "claude" | "opencode";

interface HarnessEvalOptions {
  all: boolean;
  antigravityConversationId?: string;
  candidateOutDir?: string;
  deliveryOnly: boolean;
  eventsOutDir?: string;
  harness: HarnessName;
  mcpUrl: string;
  model?: string;
  reportOut?: string;
  repeat: number;
  scenarioId?: string;
  timeoutMs: number;
}

interface CommandSpec {
  args: string[];
  command: string;
  cwd?: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
}

interface SpawnResult {
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface HarnessTokens {
  cacheRead?: number;
  cacheWrite?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

interface HarnessStep {
  cost?: number;
  reason?: string;
  tokens?: HarnessTokens;
}

interface HarnessToolCall {
  callId?: string;
  name: string;
  status?: string;
}

interface HarnessMcpArtifactProof {
  artifactId: string;
  artifactFormats: string[];
  artifactUrls: Record<string, string>;
  buildId?: string;
  buildOk: boolean;
  normalizedSpec?: unknown;
  qualityAccepted?: boolean;
  qualityScore?: number;
  status: string;
  toolCallId?: string;
  toolName: string;
}

type HarnessMcpArtifactReport = Omit<HarnessMcpArtifactProof, "normalizedSpec">;

interface HarnessOutputSummary {
  eventCount: number;
  finalJson?: unknown;
  finalText: string;
  mcpArtifacts: HarnessMcpArtifactProof[];
  stepCosts: number[];
  steps: HarnessStep[];
  toolCalls: HarnessToolCall[];
}

interface HarnessCandidateEvaluation {
  checks: ScenarioEvaluation["checks"];
  error?: string;
  excalidrawIssues: ScenarioEvaluation["excalidrawValidation"]["issues"];
  ok: boolean;
}

interface HarnessRunReport {
  candidateOut?: string;
  command: {
    args: string[];
    command: string;
  };
  conversationId?: string;
  difficulty: DiagramScenario["difficulty"];
  durationMs: number;
  error?: string;
  eventsOut?: string;
  evaluation: HarnessCandidateEvaluation;
  exitCode: number | null;
  finalJson?: unknown;
  finalText: string;
  harness: HarnessName;
  mcpArtifact?: HarnessMcpArtifactReport;
  mcpArtifactCount: number;
  mcpToolCallCount: number;
  model?: string;
  ok: boolean;
  outputContractErrors: string[];
  rawEventCount: number;
  runNumber: number;
  scenarioId: string;
  signal: NodeJS.Signals | null;
  stderrOut?: string;
  transcriptOut?: string;
  wrapperArtifactFiles: string[];
  stepCosts: number[];
  steps: HarnessStep[];
  timedOut: boolean;
  toolCalls: HarnessToolCall[];
}

interface HarnessReport {
  generatedAt: string;
  harness: HarnessName;
  mcpUrl: string;
  model?: string;
  ok: boolean;
  repeat: number;
  results: HarnessRunReport[];
  scenarioCount: number;
  summary: {
    failedEvaluations: Array<{
      runNumber: number;
      scenarioId: string;
    }>;
    mcpToolCallCount: number;
    okCount: number;
    totalCost: number;
    totalDurationMs: number;
    totalRuns: number;
  };
}

const DEFAULT_MCP_URL = "https://sketchi-studio.dimethyl.workers.dev/mcp";
const DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.5-flash";
const DEFAULT_OPENCODE_MODEL = "opencode-go/kimi-k2.7-code";
const DEFAULT_CLAUDE_MODEL = "sonnet";
const COMMAND_CLOSE_GRACE_MS = 1_000;
const COMMAND_HARD_KILL_GRACE_MS = 5_000;
const COMMAND_FORCE_SETTLE_GRACE_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 180_000;

function usage(): string {
  return [
    "Usage:",
    "  pnpm eval:harness -- --harness antigravity --model gemini-3.5-flash --scenario repo-package-interaction-flow",
    "  pnpm eval:harness -- --harness opencode --model opencode-go/kimi-k2.7-code --scenario sketchi-onboarding-decision-flow",
    "  pnpm eval:harness -- --harness opencode --model opencode-go/kimi-k2.7-code --all --repeat 3",
    "  pnpm eval:harness -- --harness claude --scenario pharma-batch-disposition",
    "",
    "Options:",
    "  --harness antigravity|opencode|claude",
    "  --model <model>",
    "  --scenario <scenario-id>",
    "  --all",
    "  --repeat <n>",
    "  --mcp-url <url>",
    "  --timeout-ms <ms>",
    "  --antigravity-conversation-id <id>",
    "  --delivery-only",
    "  --report-out <path>",
    "  --candidate-out-dir <dir>",
    "  --events-out-dir <dir>",
  ].join("\n");
}

function parseOptions(argv: readonly string[]): HarnessEvalOptions {
  const options: HarnessEvalOptions = {
    all: false,
    deliveryOnly: false,
    harness: "opencode",
    mcpUrl: DEFAULT_MCP_URL,
    repeat: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--") {
      continue;
    }

    if (arg === "--harness" && isHarnessName(next)) {
      options.harness = next;
      index += 1;
      continue;
    }
    if (arg === "--model" && next) {
      options.model = next;
      index += 1;
      continue;
    }
    if (arg === "--scenario" && next) {
      options.scenarioId = next;
      index += 1;
      continue;
    }
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--delivery-only") {
      options.deliveryOnly = true;
      continue;
    }
    if (arg === "--repeat" && next) {
      const repeat = Number.parseInt(next, 10);
      if (!Number.isInteger(repeat) || repeat < 1) {
        throw new Error("--repeat must be a positive integer.");
      }
      options.repeat = repeat;
      index += 1;
      continue;
    }
    if (arg === "--mcp-url" && next) {
      options.mcpUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      const timeoutMs = Number.parseInt(next, 10);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
        throw new Error("--timeout-ms must be an integer >= 1000.");
      }
      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }
    if (arg === "--antigravity-conversation-id" && next) {
      options.antigravityConversationId = next;
      index += 1;
      continue;
    }
    if (arg === "--report-out" && next) {
      options.reportOut = next;
      index += 1;
      continue;
    }
    if (arg === "--candidate-out-dir" && next) {
      options.candidateOutDir = next;
      index += 1;
      continue;
    }
    if (arg === "--events-out-dir" && next) {
      options.eventsOutDir = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument "${arg}".\n\n${usage()}`);
  }

  if (!options.all && !options.scenarioId) {
    throw new Error(`Missing --scenario or --all.\n\n${usage()}`);
  }
  if (options.antigravityConversationId && options.harness !== "antigravity") {
    throw new Error(
      "--antigravity-conversation-id can only be used with --harness antigravity.",
    );
  }

  return options;
}

function isHarnessName(value: string | undefined): value is HarnessName {
  return value === "antigravity" || value === "claude" || value === "opencode";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function cleanQuotedString(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Not a quoted JSON string; use the original value.
  }

  return raw;
}

function antigravityRoot(): string | undefined {
  return process.env.HOME
    ? path.join(process.env.HOME, ".gemini", "antigravity-cli")
    : undefined;
}

function antigravityAuthError(stdout: string): string | undefined {
  if (
    stdout.includes("Authentication required.") &&
    stdout.includes("Error: authentication timed out.")
  ) {
    return "Antigravity authentication timed out before MCP tools could run. Complete Agy CLI auth, then rerun the harness eval.";
  }
  return undefined;
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readAntigravityConversationId(
  cwd: string,
): Promise<string | undefined> {
  const root = antigravityRoot();
  if (!root) {
    return undefined;
  }

  const value = await readJsonFile(
    path.join(root, "cache", "last_conversations.json"),
  );
  return isRecord(value) ? stringValue(value[cwd]) : undefined;
}

function outputPathsFromTranscript(transcript: string): string[] {
  const paths = new Set<string>();
  const pattern = /file:\/\/([^\s"')]+\/output\.txt)/g;

  for (const match of transcript.matchAll(pattern)) {
    const filePath = match[1];
    if (filePath) {
      paths.add(decodeURIComponent(filePath));
    }
  }

  return [...paths];
}

function looksLikeWrapperArtifactPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return [
    ".excalidraw",
    ".json",
    ".markdown",
    ".md",
    ".mermaid",
    ".mmd",
    ".png",
    ".svg",
  ].includes(extension);
}

function stringArgumentsFrom(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return Object.values(value)
    .map(cleanQuotedString)
    .filter((argument): argument is string => Boolean(argument));
}

function wrapperArtifactPathsFromTranscript(transcript: string): string[] {
  const paths = new Set<string>();
  const fileUrlPattern = /file:\/\/([^\s"')]+)/g;

  for (const event of parseJsonLines(transcript)) {
    if (!isRecord(event)) {
      continue;
    }

    const calls = Array.isArray(event.tool_calls) ? event.tool_calls : [];
    for (const call of calls.filter(isRecord)) {
      const toolName = stringValue(call.name)?.toLowerCase();
      if (
        !toolName ||
        (!toolName.includes("write_to_file") &&
          !toolName.includes("create_file") &&
          toolName !== "create")
      ) {
        continue;
      }

      for (const argument of stringArgumentsFrom(call.args)) {
        if (
          looksLikeWrapperArtifactPath(argument) &&
          !isAntigravityInternalFile(argument)
        ) {
          paths.add(argument);
        }
      }
    }

    for (const text of textFromEvent(event)) {
      for (const match of text.matchAll(fileUrlPattern)) {
        const filePath = match[1];
        if (
          filePath &&
          looksLikeWrapperArtifactPath(filePath) &&
          !isAntigravityInternalFile(filePath)
        ) {
          paths.add(decodeURIComponent(filePath));
        }
      }
    }
  }

  return [...paths];
}

function isAntigravityInternalFile(filePath: string): boolean {
  return (
    filePath.includes(`${path.sep}.git${path.sep}`) ||
    filePath.endsWith(`${path.sep}.gitignore`) ||
    filePath.includes(
      `${path.sep}.gemini${path.sep}antigravity-cli${path.sep}builtin${path.sep}`,
    )
  );
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: Array<Awaited<ReturnType<typeof readdir>>[number]>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFilesRecursive(filePath)));
      continue;
    }
    if (entry.isFile()) {
      result.push(filePath);
    }
  }
  return result;
}

interface AntigravityEvidence {
  conversationId?: string;
  outputTexts: string[];
  transcriptOut?: string;
  transcriptText?: string;
  wrapperArtifactFiles: string[];
}

async function readAntigravityEvidenceForConversation(input: {
  conversationId: string;
  outputDir: string;
  root: string;
  stem: string;
}): Promise<AntigravityEvidence> {
  const brainDir = path.join(input.root, "brain", input.conversationId);
  const transcriptPath = path.join(
    brainDir,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  const transcriptText = await readOptionalText(transcriptPath);
  if (!transcriptText) {
    return {
      conversationId: input.conversationId,
      outputTexts: [],
      wrapperArtifactFiles: [],
    };
  }

  const transcriptOut = path.join(input.outputDir, `${input.stem}.agy.jsonl`);
  await writeText(transcriptOut, transcriptText);

  const outputTexts = (
    await Promise.all(
      outputPathsFromTranscript(transcriptText).map((filePath) =>
        readOptionalText(filePath),
      ),
    )
  ).filter((text): text is string => Boolean(text));
  const brainWrapperFiles = (await listFilesRecursive(brainDir)).filter(
    (filePath) =>
      !filePath.includes(`${path.sep}.system_generated${path.sep}`) &&
      !isAntigravityInternalFile(filePath),
  );
  const wrapperArtifactFiles = [
    ...new Set([
      ...brainWrapperFiles,
      ...wrapperArtifactPathsFromTranscript(transcriptText),
    ]),
  ];

  return {
    conversationId: input.conversationId,
    outputTexts,
    transcriptOut,
    transcriptText,
    wrapperArtifactFiles,
  };
}

async function readAntigravityEvidence(input: {
  beforeConversationId?: string;
  cwd: string;
  outputDir: string;
  stem: string;
}): Promise<AntigravityEvidence> {
  const root = antigravityRoot();
  const conversationId = await readAntigravityConversationId(input.cwd);
  if (
    !root ||
    !conversationId ||
    conversationId === input.beforeConversationId
  ) {
    return { outputTexts: [], wrapperArtifactFiles: [] };
  }

  return readAntigravityEvidenceForConversation({
    conversationId,
    outputDir: input.outputDir,
    root,
    stem: input.stem,
  });
}

function stableRunStem(input: {
  harness: HarnessName;
  repeat: number;
  runNumber: number;
  scenarioId: string;
}): string {
  const suffix =
    input.repeat > 1 ? `.run-${String(input.runNumber).padStart(3, "0")}` : "";
  return `${input.harness}.${input.scenarioId}${suffix}`;
}

function mcpConfigContent(mcpUrl: string): string {
  return JSON.stringify({
    mcp: {
      "sketchi-code-mode": {
        enabled: true,
        oauth: false,
        timeout: 30_000,
        type: "remote",
        url: mcpUrl,
      },
    },
  });
}

function claudeMcpConfig(mcpUrl: string): string {
  return JSON.stringify({
    mcpServers: {
      "sketchi-code-mode": {
        type: "http",
        url: mcpUrl,
      },
    },
  });
}

function buildHarnessPrompt(input: {
  harness: HarnessName;
  model?: string;
  runNumber: number;
  scenario: DiagramScenario;
}): string {
  const requiredLabels = input.scenario.assertions.requiredNodeLabels
    .map((label) => `- ${label}`)
    .join("\n");
  const requiredBranches = input.scenario.assertions.requiredBranchLabels
    .map((label) => `- ${label}`)
    .join("\n");
  const requiredEdges = input.scenario.assertions.requiredEdges
    .map((edge) => {
      const label = edge.label ? ` labeled "${edge.label}"` : "";
      return `- "${edge.sourceLabel}" -> "${edge.targetLabel}"${label}`;
    })
    .join("\n");

  return [
    "You are evaluating the public Sketchi Code Mode MCP server.",
    "Use the sketchi-code-mode MCP tools, not local repo code, to create a flowchart artifact for this scenario.",
    "Do not write files. Do not use raw Mermaid or raw Excalidraw JSON as the source of truth.",
    "",
    `Harness: ${input.harness}`,
    `Model: ${input.model ?? "default"}`,
    `Run number: ${input.runNumber}`,
    `Scenario id: ${input.scenario.id}`,
    `Scenario title: ${input.scenario.title}`,
    `Scenario difficulty: ${input.scenario.difficulty}`,
    `Scenario prompt: ${input.scenario.prompt}`,
    "",
    "Tool restrictions:",
    "- Use only sketchi-code-mode MCP tools and your final chat response.",
    "- In Antigravity, invoke MCP tools through `call_mcp_tool` only.",
    '- For docs/search: call `call_mcp_tool` with ServerName "sketchi-code-mode", ToolName "docs" or "search", and Arguments as a JSON string.',
    '- For execute: call `call_mcp_tool` with ServerName "sketchi-code-mode", ToolName "execute", and Arguments as a JSON string containing the JavaScript `code`.',
    "- Do not guess alternate tool names such as mcp, mcp_execute, execute, sketchi-code-mode:docs, or mcp_sketchi_code_mode_execute.",
    "- Do not run shell commands, scripts, package managers, or local MCP clients.",
    "- Do not inspect repository files, browser cache files, or Antigravity internal files.",
    "- Do not search the web.",
    "- Do not create, define, or invoke subagents.",
    "- Do not write files.",
    "- If tool syntax is unclear, use sketchi-code-mode docs/search MCP tools only.",
    "",
    "Required node labels:",
    requiredLabels,
    "",
    "Required decision branch labels:",
    requiredBranches.length > 0 ? requiredBranches : "- none",
    "",
    "Required edges:",
    requiredEdges,
    "",
    "Execution rules:",
    "- Call the MCP execute tool with JavaScript that uses sketchi.buildFlowchart.",
    '- Request artifactFormats ["scene", "excalidraw", "png"] and inlineArtifacts ["excalidraw"].',
    "- If buildFlowchart returns ok:false, repair the FlowchartSpec and try again.",
    "- Stop after at most 3 build attempts.",
    "- The run is not complete after an MCP tool call.",
    "- After the accepted buildFlowchart result, emit the final JSON object.",
    "- Final artifactId must exactly match artifact.artifactId returned by the accepted MCP execute result.",
    "- Final JSON must include artifactFormats from the accepted MCP artifact bundle.",
    "- Final JSON must include excalidrawUrl and pngUrl from artifact format refs or getArtifact responses.",
    "- Preserve the requested semantic graph over visual preference.",
    "- Do not create or describe a separate Markdown/Mermaid diagram as the final artifact.",
    "- Final response must be JSON only, no markdown, no prose.",
    "",
    "Final JSON shape:",
    JSON.stringify(
      {
        artifactId: "...",
        artifactFormats: ["scene", "excalidraw", "png"],
        attempts: 1,
        buildOk: true,
        diagramId: "...",
        excalidrawUrl:
          "https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/...?...",
        harness: input.harness,
        issues: [],
        model: input.model ?? "default",
        normalizedSpec: {
          edges: [],
          id: input.scenario.id,
          layout: { direction: "TB" },
          nodes: [],
          style: {
            accentColor: "#000000",
            backgroundColor: "#ffffff",
          },
          title: input.scenario.title,
        },
        pngUrl:
          "https://sketchi-studio.dimethyl.workers.dev/api/v1/artifacts/...?...",
        qualityScore: 10,
        scenarioId: input.scenario.id,
        status: "accepted",
      },
      null,
      2,
    ),
  ].join("\n");
}

export function commandForRun(input: {
  harness: HarnessName;
  mcpUrl: string;
  model?: string;
  prompt: string;
  scenarioId: string;
  timeoutMs: number;
}): CommandSpec {
  if (input.harness === "antigravity") {
    const model = input.model ?? DEFAULT_ANTIGRAVITY_MODEL;
    const timeoutSeconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
    return {
      args: [
        "--print-timeout",
        `${timeoutSeconds}s`,
        "--dangerously-skip-permissions",
        "--model",
        model,
        "--print",
        input.prompt,
      ],
      command: "agy",
      env: process.env,
      prompt: input.prompt,
    };
  }

  if (input.harness === "opencode") {
    const model = input.model ?? DEFAULT_OPENCODE_MODEL;
    return {
      args: [
        "run",
        "--model",
        model,
        "--format",
        "json",
        "--title",
        `sketchi-harness-${input.scenarioId}`,
        "--dir",
        process.cwd(),
        input.prompt,
      ],
      command: "opencode",
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: mcpConfigContent(input.mcpUrl),
      },
      prompt: input.prompt,
    };
  }

  const model = input.model ?? DEFAULT_CLAUDE_MODEL;
  return {
    args: [
      "-p",
      input.prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      model,
      "--mcp-config",
      claudeMcpConfig(input.mcpUrl),
      "--strict-mcp-config",
      "--permission-mode",
      "bypassPermissions",
      "--no-session-persistence",
    ],
    command: "claude",
    env: process.env,
    prompt: input.prompt,
  };
}

export function runCommand(
  spec: CommandSpec,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    let observedExitCode: number | null = null;
    let observedSignal: NodeJS.Signals | null = null;
    let hardKill: NodeJS.Timeout | undefined;
    let forceSettle: NodeJS.Timeout | undefined;
    let closeGrace: NodeJS.Timeout | undefined;

    const result = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      errorMessage?: string,
    ): SpawnResult => ({
      durationMs: Date.now() - started,
      exitCode,
      signal,
      stderr: [Buffer.concat(stderr).toString("utf8"), errorMessage]
        .filter((text): text is string => Boolean(text))
        .join("\n"),
      stdout: Buffer.concat(stdout).toString("utf8"),
      timedOut,
    });

    const settle = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      errorMessage?: string,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result(exitCode, signal, errorMessage));
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      hardKill = setTimeout(() => {
        child.kill("SIGKILL");
      }, COMMAND_HARD_KILL_GRACE_MS);
      forceSettle = setTimeout(() => {
        settle(observedExitCode, observedSignal);
      }, COMMAND_HARD_KILL_GRACE_MS + COMMAND_FORCE_SETTLE_GRACE_MS);
    }, timeoutMs);

    const clearTimers = () => {
      clearTimeout(timeout);
      if (hardKill) {
        clearTimeout(hardKill);
      }
      if (forceSettle) {
        clearTimeout(forceSettle);
      }
      if (closeGrace) {
        clearTimeout(closeGrace);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      settle(1, null, error.message);
    });
    child.on("exit", (exitCode, signal) => {
      observedExitCode = exitCode;
      observedSignal = signal;
      clearTimeout(timeout);
      closeGrace = setTimeout(() => {
        settle(exitCode, signal);
      }, COMMAND_CLOSE_GRACE_MS);
    });
    child.on("close", (exitCode, signal) => {
      observedExitCode = exitCode;
      observedSignal = signal;
      settle(exitCode, signal);
    });
  });
}

function parseJsonLines(stdout: string): unknown[] {
  const events: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Human-readable non-JSON lines from wrappers are ignored here but remain
      // in the persisted raw stdout evidence.
    }
  }
  return events;
}

function tokensFrom(value: unknown): HarnessTokens | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const cache = isRecord(value.cache) ? value.cache : undefined;
  const input = numberValue(value.input) ?? numberValue(value.input_tokens);
  const output = numberValue(value.output) ?? numberValue(value.output_tokens);
  const cacheRead =
    numberValue(cache?.read) ?? numberValue(value.cache_read_input_tokens);
  const cacheWrite =
    numberValue(cache?.write) ?? numberValue(value.cache_creation_input_tokens);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(numberValue(value.reasoning) === undefined
      ? {}
      : { reasoning: numberValue(value.reasoning) }),
    ...(numberValue(value.total) === undefined
      ? {}
      : { total: numberValue(value.total) }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  };
}

function maybeParseJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return undefined;
    }
  }
}

function finalJsonFromTextParts(textParts: string[]): {
  finalJson?: unknown;
  finalText: string;
} {
  let lastTextIndex = -1;
  for (let index = textParts.length - 1; index >= 0; index -= 1) {
    if ((textParts[index]?.trim() ?? "").length > 0) {
      lastTextIndex = index;
      break;
    }
  }
  if (lastTextIndex === -1) {
    return { finalText: "" };
  }

  const finalText = textParts[lastTextIndex]?.trim() ?? "";
  const parsedFinal = maybeParseJsonObject(finalText);
  if (parsedFinal !== undefined) {
    return { finalJson: parsedFinal, finalText };
  }

  if (!finalText.includes("{") && !finalText.includes("}")) {
    return { finalText };
  }

  let suffix = "";
  for (let index = lastTextIndex; index >= 0; index -= 1) {
    suffix = `${textParts[index] ?? ""}${suffix}`;
    const parsed = maybeParseJsonObject(suffix);
    if (parsed !== undefined) {
      return { finalJson: parsed, finalText: suffix.trim() };
    }
  }

  return { finalText };
}

function isAntigravityToolOutputEvent(type: string | undefined): boolean {
  return [
    "CODE_ACTION",
    "ERROR_MESSAGE",
    "GREP_SEARCH",
    "LIST_DIR",
    "MCP_TOOL",
    "RUN_COMMAND",
    "VIEW_FILE",
  ].includes(type ?? "");
}

function textFromEvent(event: unknown): string[] {
  if (!isRecord(event)) {
    return [];
  }
  const part = isRecord(event.part) ? event.part : undefined;
  const eventType = stringValue(event.type);
  const isToolOutput = isAntigravityToolOutputEvent(eventType);
  const messageRecord = isRecord(event.message) ? event.message : undefined;
  const content = Array.isArray(messageRecord?.content)
    ? messageRecord.content
    : [];
  const result = isToolOutput ? undefined : stringValue(event.result);
  const eventContent = isToolOutput ? undefined : stringValue(event.content);
  const text = stringValue(part?.text);
  const message = isToolOutput ? undefined : stringValue(event.message);
  const contentText = isToolOutput
    ? []
    : content
        .filter(isRecord)
        .map((item) =>
          stringValue(item.type) === "text"
            ? stringValue(item.text)
            : undefined,
        );
  return [result, eventContent, text, message, ...contentText].filter(
    (value): value is string => Boolean(value),
  );
}

function toolCallsFromEvent(event: unknown): HarnessToolCall[] {
  if (!isRecord(event)) {
    return [];
  }
  const calls: HarnessToolCall[] = [];
  const part = isRecord(event.part) ? event.part : undefined;
  const type = stringValue(event.type) ?? stringValue(part?.type);

  if (type === "tool_use" || type === "tool") {
    const toolName = stringValue(part?.tool) ?? stringValue(event.tool);
    if (toolName) {
      const state = isRecord(part?.state) ? part?.state : undefined;
      const status = stringValue(state?.status);
      calls.push({
        ...(stringValue(part?.callID)
          ? { callId: stringValue(part?.callID) }
          : {}),
        name: toolName,
        ...(status ? { status } : {}),
      });
    }
  }

  const messageRecord = isRecord(event.message) ? event.message : undefined;
  const content = Array.isArray(messageRecord?.content)
    ? messageRecord.content
    : [];
  for (const item of content.filter(isRecord)) {
    if (stringValue(item.type) !== "tool_use") {
      continue;
    }
    const name = stringValue(item.name);
    const callId = stringValue(item.id);
    if (name) {
      calls.push({
        ...(callId ? { callId } : {}),
        name,
      });
    }
  }

  const agyToolCalls = Array.isArray(event.tool_calls) ? event.tool_calls : [];
  for (const call of agyToolCalls.filter(isRecord)) {
    const name = stringValue(call.name);
    const args = isRecord(call.args) ? call.args : undefined;
    if (name === "call_mcp_tool") {
      const serverName = cleanQuotedString(args?.ServerName);
      const toolName = cleanQuotedString(args?.ToolName);
      if (serverName && toolName) {
        calls.push({
          name: `mcp(${serverName}/${toolName})`,
          ...(stringValue(event.status)
            ? { status: stringValue(event.status) }
            : {}),
        });
      }
      continue;
    }
    if (name) {
      calls.push({
        name,
        ...(stringValue(event.status)
          ? { status: stringValue(event.status) }
          : {}),
      });
    }
  }

  return calls;
}

function successfulMcpToolCallCount(toolCalls: HarnessToolCall[]): number {
  const seen = new Set<string>();

  for (const call of toolCalls) {
    if (!call.name.includes("sketchi-code-mode")) {
      continue;
    }
    const status = call.status?.toLowerCase();
    if (status && status !== "completed" && status !== "done") {
      continue;
    }
    const key = call.callId ?? `${call.name}:${seen.size}`;
    seen.add(key);
  }

  return seen.size;
}

function parseJsonPayload(value: unknown): unknown | undefined {
  if (typeof value === "string") {
    return maybeParseJsonObject(value);
  }
  return isRecord(value) ? value : undefined;
}

function acceptedBuildResultFrom(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.artifact) && value.ok === true) {
    return value;
  }
  if (
    value.ok === true &&
    stringValue(value.artifactId) &&
    Array.isArray(value.formats)
  ) {
    return value;
  }
  return acceptedBuildResultFrom(value.result);
}

function compactArtifactResultFrom(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    stringValue(value.artifactId) &&
    Array.isArray(value.artifactFormats) &&
    (value.buildOk === true || stringValue(value.status) === "accepted")
  ) {
    return value;
  }
  return compactArtifactResultFrom(value.result);
}

function artifactFormatsFrom(artifact: Record<string, unknown> | undefined) {
  const formats = Array.isArray(artifact?.formats) ? artifact.formats : [];
  return formats.filter(isRecord).map((formatRef) => ({
    format: stringValue(formatRef.format),
    url: stringValue(formatRef.url),
  }));
}

function artifactProofFromDelivery(input: {
  callId?: string;
  delivery: unknown;
  toolName: string;
}): HarnessMcpArtifactProof | undefined {
  if (!isRecord(input.delivery)) {
    return undefined;
  }

  const artifactId = stringValue(input.delivery.artifactId);
  const artifactFormats = artifactFormatsFrom(input.delivery);
  if (!artifactId || artifactFormats.length === 0) {
    return undefined;
  }

  return {
    artifactId,
    artifactFormats: artifactFormats
      .map((formatRef) => formatRef.format)
      .filter((format): format is string => Boolean(format)),
    artifactUrls: Object.fromEntries(
      artifactFormats
        .filter((formatRef): formatRef is { format: string; url: string } =>
          Boolean(formatRef.format && formatRef.url),
        )
        .map((formatRef) => [formatRef.format, formatRef.url]),
    ),
    buildOk: true,
    ...(stringValue(input.delivery.diagramId)
      ? {
          normalizedSpec: {
            id: stringValue(input.delivery.diagramId),
          },
        }
      : {}),
    status: "accepted",
    ...(input.callId ? { toolCallId: input.callId } : {}),
    toolName: input.toolName,
  };
}

function artifactProofFromCompactResult(input: {
  callId?: string;
  result: unknown;
  toolName: string;
}): HarnessMcpArtifactProof | undefined {
  const result = compactArtifactResultFrom(input.result);
  if (!result) {
    return undefined;
  }

  const artifactId = stringValue(result.artifactId);
  const artifactFormats = Array.isArray(result.artifactFormats)
    ? result.artifactFormats.filter(
        (format): format is string => typeof format === "string",
      )
    : [];
  const status = stringValue(result.status) ?? "accepted";
  if (!artifactId || artifactFormats.length === 0 || status !== "accepted") {
    return undefined;
  }

  return {
    artifactId,
    artifactFormats,
    artifactUrls: {
      ...(stringValue(result.sceneUrl)
        ? { scene: stringValue(result.sceneUrl) }
        : {}),
      ...(stringValue(result.excalidrawUrl)
        ? { excalidraw: stringValue(result.excalidrawUrl) }
        : {}),
      ...(stringValue(result.pngUrl)
        ? { png: stringValue(result.pngUrl) }
        : {}),
    },
    buildOk: true,
    ...(result.normalizedSpec === undefined
      ? {}
      : { normalizedSpec: result.normalizedSpec }),
    ...(numberValue(result.qualityScore) === undefined
      ? {}
      : { qualityScore: numberValue(result.qualityScore) }),
    status,
    ...(input.callId ? { toolCallId: input.callId } : {}),
    toolName: input.toolName,
  };
}

function mcpArtifactFromPayload(input: {
  callId?: string;
  payload: unknown;
  toolName: string;
}): HarnessMcpArtifactProof | undefined {
  const payload = parseJsonPayload(input.payload);
  if (!isRecord(payload)) {
    return undefined;
  }

  const compactProof = artifactProofFromCompactResult({
    ...(input.callId ? { callId: input.callId } : {}),
    result: payload,
    toolName: input.toolName,
  });
  if (compactProof) {
    return compactProof;
  }

  const result = acceptedBuildResultFrom(payload);
  if (!result || payload.ok !== true) {
    return artifactProofFromDelivery({
      ...(input.callId ? { callId: input.callId } : {}),
      delivery: payload.artifactDelivery,
      toolName: input.toolName,
    });
  }

  const artifact = isRecord(result.artifact) ? result.artifact : result;
  const quality = isRecord(result.quality) ? result.quality : undefined;
  const artifactId = stringValue(artifact?.artifactId);
  const artifactFormats = artifactFormatsFrom(artifact);
  const status = stringValue(result.status) ?? "accepted";
  const normalizedSpec = result.normalizedSpec;
  const buildOk = result.ok === true;

  if (!buildOk || status !== "accepted" || !artifactId) {
    return undefined;
  }

  return {
    artifactId,
    artifactFormats: artifactFormats
      .map((formatRef) => formatRef.format)
      .filter((format): format is string => Boolean(format)),
    artifactUrls: Object.fromEntries(
      artifactFormats
        .filter((formatRef): formatRef is { format: string; url: string } =>
          Boolean(formatRef.format && formatRef.url),
        )
        .map((formatRef) => [formatRef.format, formatRef.url]),
    ),
    ...(stringValue(result.buildId)
      ? { buildId: stringValue(result.buildId) }
      : {}),
    buildOk,
    ...(normalizedSpec === undefined ? {} : { normalizedSpec }),
    ...(quality?.accepted === true ? { qualityAccepted: true } : {}),
    ...(numberValue(quality?.score) === undefined
      ? {}
      : { qualityScore: numberValue(quality?.score) }),
    status,
    ...(input.callId ? { toolCallId: input.callId } : {}),
    toolName: input.toolName,
  };
}

function mcpArtifactsFromEvent(input: {
  event: unknown;
  toolNamesById: Map<string, string>;
}): HarnessMcpArtifactProof[] {
  if (!isRecord(input.event)) {
    return [];
  }
  const proofs: HarnessMcpArtifactProof[] = [];
  const part = isRecord(input.event.part) ? input.event.part : undefined;
  const state = isRecord(part?.state) ? part.state : undefined;
  const toolName = stringValue(part?.tool) ?? stringValue(input.event.tool);
  const callId = stringValue(part?.callID);

  if (toolName?.includes("sketchi-code-mode_execute") && state?.output) {
    const proof = mcpArtifactFromPayload({
      ...(callId ? { callId } : {}),
      payload: state.output,
      toolName,
    });
    if (proof) {
      proofs.push(proof);
    }
  }

  if (stringValue(input.event.type) === "MCP_TOOL") {
    const content = stringValue(input.event.content);
    if (content) {
      const proof = mcpArtifactFromPayload({
        payload: content,
        toolName: "mcp(sketchi-code-mode/execute)",
      });
      if (proof) {
        proofs.push(proof);
      }
    }
  }

  const messageRecord = isRecord(input.event.message)
    ? input.event.message
    : undefined;
  const content = Array.isArray(messageRecord?.content)
    ? messageRecord.content
    : [];

  for (const item of content.filter(isRecord)) {
    if (stringValue(item.type) === "tool_use") {
      const id = stringValue(item.id);
      const name = stringValue(item.name);
      if (id && name) {
        input.toolNamesById.set(id, name);
      }
      continue;
    }

    if (stringValue(item.type) !== "tool_result") {
      continue;
    }

    const resultCallId = stringValue(item.tool_use_id);
    const resultToolName = resultCallId
      ? input.toolNamesById.get(resultCallId)
      : undefined;
    if (!resultToolName?.includes("sketchi-code-mode__execute")) {
      continue;
    }

    const proof =
      mcpArtifactFromPayload({
        ...(resultCallId ? { callId: resultCallId } : {}),
        payload: item.structuredContent,
        toolName: resultToolName,
      }) ??
      mcpArtifactFromPayload({
        ...(resultCallId ? { callId: resultCallId } : {}),
        payload: item.content,
        toolName: resultToolName,
      });
    if (proof) {
      proofs.push(proof);
    }
  }

  return proofs;
}

function stepFromEvent(event: unknown): HarnessStep | undefined {
  if (!isRecord(event)) {
    return undefined;
  }
  const part = isRecord(event.part) ? event.part : undefined;
  const type = stringValue(event.type) ?? stringValue(part?.type);

  if (type === "step_finish" || type === "step-finish") {
    const tokens = tokensFrom(part?.tokens ?? event.tokens);
    const cost = numberValue(part?.cost ?? event.cost);
    return {
      ...(cost === undefined ? {} : { cost }),
      ...(stringValue(part?.reason ?? event.reason)
        ? { reason: stringValue(part?.reason ?? event.reason) }
        : {}),
      ...(tokens === undefined ? {} : { tokens }),
    };
  }

  if (type === "result") {
    const tokens = tokensFrom(event.usage);
    const cost = numberValue(event.total_cost_usd);
    return {
      ...(cost === undefined ? {} : { cost }),
      ...(stringValue(event.terminal_reason)
        ? { reason: stringValue(event.terminal_reason) }
        : {}),
      ...(tokens === undefined ? {} : { tokens }),
    };
  }

  return undefined;
}

export function summarizeHarnessStdout(
  stdout: string,
  extraPayloads: readonly unknown[] = [],
): HarnessOutputSummary {
  const events = parseJsonLines(stdout);
  const textParts: string[] = [];
  const mcpArtifacts: HarnessMcpArtifactProof[] = [];
  const toolCalls: HarnessToolCall[] = [];
  const toolNamesById = new Map<string, string>();
  const steps: HarnessStep[] = [];

  for (const event of events) {
    textParts.push(...textFromEvent(event));
    toolCalls.push(...toolCallsFromEvent(event));
    mcpArtifacts.push(
      ...mcpArtifactsFromEvent({
        event,
        toolNamesById,
      }),
    );
    const step = stepFromEvent(event);
    if (step) {
      steps.push(step);
    }
  }

  for (const payload of extraPayloads) {
    const proof = mcpArtifactFromPayload({
      payload,
      toolName: "mcp(sketchi-code-mode/execute)",
    });
    if (proof) {
      mcpArtifacts.push(proof);
    }
  }

  const { finalJson, finalText } = finalJsonFromTextParts(textParts);
  return {
    eventCount: events.length,
    ...(finalJson === undefined ? {} : { finalJson }),
    finalText,
    mcpArtifacts,
    stepCosts: steps
      .map((step) => step.cost)
      .filter((value): value is number => value !== undefined),
    steps,
    toolCalls,
  };
}

function normalizedSpecFrom(value: unknown): unknown | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.normalizedSpec)) {
    return value.normalizedSpec;
  }
  if (isRecord(value.result)) {
    return normalizedSpecFrom(value.result);
  }
  return undefined;
}

function specToFlowchartCandidate(spec: unknown): unknown {
  if (!isRecord(spec)) {
    return spec;
  }
  const layout = isRecord(spec.layout) ? spec.layout : {};
  return {
    id: spec.id,
    title: spec.title,
    type: "flowchart",
    nodes: spec.nodes,
    edges: spec.edges,
    layout: {
      direction: layout.direction ?? "TB",
      edgeRouting: "orthogonal",
    },
    style: spec.style,
  };
}

function evaluateHarnessJson(
  scenario: DiagramScenario,
  value: unknown,
): HarnessCandidateEvaluation {
  const spec = normalizedSpecFrom(value);
  try {
    const evaluation = evaluateScenarioDiagram(
      scenario,
      specToFlowchartCandidate(spec ?? value),
    );
    return {
      checks: evaluation.checks,
      excalidrawIssues: evaluation.excalidrawValidation.issues,
      ok: evaluation.ok,
    };
  } catch (error) {
    return {
      checks: [],
      error: error instanceof Error ? error.message : String(error),
      excalidrawIssues: [],
      ok: false,
    };
  }
}

function reportableMcpArtifact(
  proof: HarnessMcpArtifactProof | undefined,
): HarnessMcpArtifactReport | undefined {
  if (!proof) {
    return undefined;
  }
  const { normalizedSpec: _normalizedSpec, ...report } = proof;
  return report;
}

export function outputContractErrors(input: {
  finalJson: unknown | undefined;
  finalText: string;
  proof: HarnessMcpArtifactProof | undefined;
}): string[] {
  if (!input.proof) {
    return [
      "No successful sketchi-code-mode execute artifact was observed in the harness event stream.",
    ];
  }

  return [];
}

function proofForFinalOutput(
  summary: HarnessOutputSummary,
): HarnessMcpArtifactProof | undefined {
  const finalArtifactId = isRecord(summary.finalJson)
    ? stringValue(summary.finalJson.artifactId)
    : undefined;
  if (finalArtifactId) {
    const matchingProof = summary.mcpArtifacts
      .toReversed()
      .find((proof) => proof.artifactId === finalArtifactId);
    if (matchingProof) {
      return matchingProof;
    }
  }

  return summary.mcpArtifacts.at(-1);
}

async function writeText(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function redactedCommandForReport(spec: CommandSpec): {
  args: string[];
  command: string;
} {
  const args = spec.args.map((arg) =>
    arg === spec.prompt ? "<eval prompt>" : arg,
  );
  return {
    args,
    command: spec.command,
  };
}

function replayCommandForReport(conversationId: string): {
  args: string[];
  command: string;
} {
  return {
    args: ["<replay>", conversationId],
    command: "agy",
  };
}

async function runHarnessScenario(input: {
  options: HarnessEvalOptions;
  outputDir: string;
  repeat: number;
  runNumber: number;
  scenario: DiagramScenario;
}): Promise<HarnessRunReport> {
  const stem = stableRunStem({
    harness: input.options.harness,
    repeat: input.repeat,
    runNumber: input.runNumber,
    scenarioId: input.scenario.id,
  });
  const eventsDir = input.options.eventsOutDir ?? input.outputDir;
  const candidateDir = input.options.candidateOutDir ?? input.outputDir;
  const eventsOut = path.join(eventsDir, `${stem}.stdout.jsonl`);
  const stderrOut = path.join(eventsDir, `${stem}.stderr.txt`);
  const candidateOut = path.join(candidateDir, `${stem}.candidate.json`);
  const beforeAntigravityConversationId =
    input.options.harness === "antigravity" &&
    !input.options.antigravityConversationId
      ? await readAntigravityConversationId(process.cwd())
      : undefined;
  const prompt = buildHarnessPrompt({
    harness: input.options.harness,
    model: input.options.model,
    runNumber: input.runNumber,
    scenario: input.scenario,
  });
  const command = commandForRun({
    harness: input.options.harness,
    mcpUrl: input.options.mcpUrl,
    model: input.options.model,
    prompt,
    scenarioId: input.scenario.id,
    timeoutMs: input.options.timeoutMs,
  });
  const result: SpawnResult = input.options.antigravityConversationId
    ? {
        durationMs: 0,
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout: "",
        timedOut: false,
      }
    : await runCommand(command, input.options.timeoutMs);
  const antigravityRootForReplay = antigravityRoot();
  const antigravityEvidence =
    input.options.antigravityConversationId && antigravityRootForReplay
      ? await readAntigravityEvidenceForConversation({
          conversationId: input.options.antigravityConversationId,
          outputDir: eventsDir,
          root: antigravityRootForReplay,
          stem,
        })
      : input.options.harness === "antigravity"
        ? await readAntigravityEvidence({
            beforeConversationId: beforeAntigravityConversationId,
            cwd: process.cwd(),
            outputDir: eventsDir,
            stem,
          })
        : {
            outputTexts: [],
            wrapperArtifactFiles: [],
          };
  const combinedStdout = [result.stdout, antigravityEvidence.transcriptText]
    .filter((text): text is string => Boolean(text))
    .join("\n");
  const summary = summarizeHarnessStdout(
    combinedStdout,
    antigravityEvidence.outputTexts,
  );
  const mcpProof = proofForFinalOutput(summary);
  const authError =
    input.options.harness === "antigravity"
      ? antigravityAuthError(result.stdout)
      : undefined;
  const outputErrors = [
    ...(authError
      ? [authError]
      : outputContractErrors({
          finalJson: summary.finalJson,
          finalText: summary.finalText,
          proof: mcpProof,
        })),
    ...(antigravityEvidence.wrapperArtifactFiles.length === 0
      ? []
      : [
          `Antigravity created wrapper artifact file(s): ${antigravityEvidence.wrapperArtifactFiles.join(
            ", ",
          )}. Return the Sketchi artifact delivery in chat instead.`,
        ]),
  ].filter((message): message is string => Boolean(message));
  const artifactEvaluation = authError
    ? {
        checks: [],
        error: authError,
        excalidrawIssues: [],
        ok: false,
      }
    : input.options.deliveryOnly
      ? {
          checks: [],
          ...(mcpProof
            ? {}
            : {
                error:
                  "No successful sketchi-code-mode execute artifact was observed in the harness event stream.",
              }),
          excalidrawIssues: [],
          ok: Boolean(mcpProof),
        }
      : mcpProof
        ? evaluateHarnessJson(
            input.scenario,
            mcpProof.normalizedSpec === undefined
              ? summary.finalJson
              : {
                  normalizedSpec: mcpProof.normalizedSpec,
                },
          )
        : {
            checks: [],
            error:
              "No successful sketchi-code-mode execute artifact was observed in the harness event stream.",
            excalidrawIssues: [],
            ok: false,
          };
  const evaluation: HarnessCandidateEvaluation =
    outputErrors.length === 0
      ? artifactEvaluation
      : {
          ...artifactEvaluation,
          error: [...new Set([artifactEvaluation.error, ...outputErrors])]
            .filter((message): message is string => Boolean(message))
            .join(" "),
          ok: false,
        };

  await writeText(eventsOut, combinedStdout);
  await writeText(stderrOut, result.stderr);
  await writeJson(candidateOut, {
    ...(antigravityEvidence.conversationId
      ? { conversationId: antigravityEvidence.conversationId }
      : {}),
    finalJson: summary.finalJson,
    finalText: summary.finalText,
    mcpArtifact: reportableMcpArtifact(mcpProof),
    outputContractErrors: outputErrors,
    ...(antigravityEvidence.transcriptOut
      ? { transcriptOut: antigravityEvidence.transcriptOut }
      : {}),
    wrapperArtifactFiles: antigravityEvidence.wrapperArtifactFiles,
  });

  const runError = evaluation.error;

  return {
    candidateOut,
    command: input.options.antigravityConversationId
      ? replayCommandForReport(input.options.antigravityConversationId)
      : redactedCommandForReport(command),
    ...(antigravityEvidence.conversationId
      ? { conversationId: antigravityEvidence.conversationId }
      : {}),
    difficulty: input.scenario.difficulty,
    durationMs: result.durationMs,
    ...(runError ? { error: runError } : {}),
    eventsOut,
    evaluation,
    exitCode: result.exitCode,
    ...(summary.finalJson === undefined
      ? {}
      : { finalJson: summary.finalJson }),
    finalText: summary.finalText,
    harness: input.options.harness,
    ...(mcpProof ? { mcpArtifact: reportableMcpArtifact(mcpProof) } : {}),
    mcpArtifactCount: summary.mcpArtifacts.length,
    mcpToolCallCount: successfulMcpToolCallCount(summary.toolCalls),
    ...(input.options.model ? { model: input.options.model } : {}),
    ok:
      result.exitCode === 0 &&
      !result.timedOut &&
      outputErrors.length === 0 &&
      evaluation.ok,
    outputContractErrors: outputErrors,
    rawEventCount: summary.eventCount,
    runNumber: input.runNumber,
    scenarioId: input.scenario.id,
    signal: result.signal,
    stderrOut,
    ...(antigravityEvidence.transcriptOut
      ? { transcriptOut: antigravityEvidence.transcriptOut }
      : {}),
    wrapperArtifactFiles: antigravityEvidence.wrapperArtifactFiles,
    stepCosts: summary.stepCosts,
    steps: summary.steps,
    timedOut: result.timedOut,
    toolCalls: summary.toolCalls,
  };
}

function summarizeReport(input: {
  harness: HarnessName;
  mcpUrl: string;
  model?: string;
  repeat: number;
  results: HarnessRunReport[];
  scenarioCount: number;
}): HarnessReport {
  const okCount = input.results.filter((result) => result.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    harness: input.harness,
    mcpUrl: input.mcpUrl,
    ...(input.model ? { model: input.model } : {}),
    ok: okCount === input.results.length,
    repeat: input.repeat,
    results: input.results,
    scenarioCount: input.scenarioCount,
    summary: {
      failedEvaluations: input.results
        .filter((result) => !result.ok)
        .map((result) => ({
          runNumber: result.runNumber,
          scenarioId: result.scenarioId,
        })),
      mcpToolCallCount: input.results.reduce(
        (sum, result) => sum + result.mcpToolCallCount,
        0,
      ),
      okCount,
      totalCost: input.results.reduce(
        (sum, result) =>
          sum + result.stepCosts.reduce((costSum, cost) => costSum + cost, 0),
        0,
      ),
      totalDurationMs: input.results.reduce(
        (sum, result) => sum + result.durationMs,
        0,
      ),
      totalRuns: input.results.length,
    },
  };
}

function scenariosFor(options: HarnessEvalOptions): DiagramScenario[] {
  return options.all
    ? flowchartScenarios
    : [getScenario(options.scenarioId ?? "")];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const scenarios = scenariosFor(options);
  const outputDir =
    options.reportOut === undefined
      ? path.join(
          ".memory",
          "harness-evals",
          new Date().toISOString().replace(/[:.]/g, "-"),
        )
      : path.dirname(options.reportOut);
  const results: HarnessRunReport[] = [];
  const reportOut = options.reportOut ?? path.join(outputDir, "report.json");
  const writeCurrentReport = async (): Promise<HarnessReport> => {
    const report = summarizeReport({
      harness: options.harness,
      mcpUrl: options.mcpUrl,
      model: options.model,
      repeat: options.repeat,
      results,
      scenarioCount: scenarios.length,
    });
    await writeJson(reportOut, report);
    return report;
  };

  for (let repeatIndex = 0; repeatIndex < options.repeat; repeatIndex += 1) {
    for (const scenario of scenarios) {
      const runNumber = repeatIndex + 1;
      console.error(
        `harness=${options.harness} scenario=${scenario.id} run=${runNumber}/${options.repeat}`,
      );
      results.push(
        await runHarnessScenario({
          options,
          outputDir,
          repeat: options.repeat,
          runNumber,
          scenario,
        }),
      );
      await writeCurrentReport();
    }
  }

  const report = await writeCurrentReport();
  console.log(JSON.stringify({ ...report, reportOut }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

const entryPointPath = process.argv[1];

if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
