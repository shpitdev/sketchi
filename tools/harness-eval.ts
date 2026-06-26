import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateScenarioDiagram,
  flowchartScenarios,
  getScenario,
  type DiagramScenario,
  type ScenarioEvaluation,
} from "@sketchi/diagram-scenarios";

type HarnessName = "claude" | "opencode";

interface HarnessEvalOptions {
  all: boolean;
  candidateOutDir?: string;
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
  buildId?: string;
  buildOk: boolean;
  normalizedSpec: unknown;
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
const DEFAULT_OPENCODE_MODEL = "opencode-go/kimi-k2.7-code";
const DEFAULT_CLAUDE_MODEL = "sonnet";
const DEFAULT_TIMEOUT_MS = 180_000;

function usage(): string {
  return [
    "Usage:",
    "  pnpm eval:harness -- --harness opencode --model opencode-go/kimi-k2.7-code --scenario sketchi-onboarding-decision-flow",
    "  pnpm eval:harness -- --harness opencode --model opencode-go/kimi-k2.7-code --all --repeat 3",
    "  pnpm eval:harness -- --harness claude --scenario pharma-batch-disposition",
    "",
    "Options:",
    "  --harness opencode|claude",
    "  --model <model>",
    "  --scenario <scenario-id>",
    "  --all",
    "  --repeat <n>",
    "  --mcp-url <url>",
    "  --timeout-ms <ms>",
    "  --report-out <path>",
    "  --candidate-out-dir <dir>",
    "  --events-out-dir <dir>",
  ].join("\n");
}

function parseOptions(argv: readonly string[]): HarnessEvalOptions {
  const options: HarnessEvalOptions = {
    all: false,
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

  return options;
}

function isHarnessName(value: string | undefined): value is HarnessName {
  return value === "claude" || value === "opencode";
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
    "- The scenario below is complete; use docs/search only if the MCP call syntax is unclear.",
    "- Call the MCP execute tool with JavaScript that uses sketchi.buildFlowchart.",
    '- Request artifactFormats ["scene", "excalidraw"] and inlineArtifacts ["scene"].',
    "- If buildFlowchart returns ok:false, repair the FlowchartSpec and try again.",
    "- Stop after at most 3 build attempts.",
    "- The run is not complete after an MCP tool call.",
    "- After the accepted buildFlowchart result, emit the final JSON object.",
    "- Final artifactId must exactly match artifact.artifactId returned by the accepted MCP execute result.",
    "- Preserve the requested semantic graph over visual preference.",
    "- Final response must be JSON only, no markdown, no prose.",
    "",
    "Final JSON shape:",
    JSON.stringify(
      {
        artifactId: "...",
        attempts: 1,
        buildOk: true,
        diagramId: "...",
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
        qualityScore: 10,
        scenarioId: input.scenario.id,
        status: "accepted",
      },
      null,
      2,
    ),
  ].join("\n");
}

function commandForRun(input: {
  harness: HarnessName;
  mcpUrl: string;
  model?: string;
  prompt: string;
  scenarioId: string;
}): CommandSpec {
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

function runCommand(
  spec: CommandSpec,
  timeoutMs: number,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(spec.command, spec.args, {
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let hardKill: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      hardKill = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
    }, timeoutMs);

    const clearTimers = () => {
      clearTimeout(timeout);
      if (hardKill) {
        clearTimeout(hardKill);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimers();
      resolve({
        durationMs: Date.now() - started,
        exitCode: 1,
        signal: null,
        stderr: error.message,
        stdout: Buffer.concat(stdout).toString("utf8"),
        timedOut,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimers();
      resolve({
        durationMs: Date.now() - started,
        exitCode,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
        timedOut,
      });
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
  for (let index = textParts.length - 1; index >= 0; index -= 1) {
    const text = textParts[index]?.trim() ?? "";
    const parsed = maybeParseJsonObject(text);
    if (parsed !== undefined) {
      return { finalJson: parsed, finalText: text };
    }
  }

  let suffix = "";
  for (let index = textParts.length - 1; index >= 0; index -= 1) {
    suffix = `${textParts[index] ?? ""}${suffix}`;
    const parsed = maybeParseJsonObject(suffix);
    if (parsed !== undefined) {
      return { finalJson: parsed, finalText: suffix.trim() };
    }
  }

  return { finalText: textParts.at(-1)?.trim() ?? "" };
}

function textFromEvent(event: unknown): string[] {
  if (!isRecord(event)) {
    return [];
  }
  const part = isRecord(event.part) ? event.part : undefined;
  const messageRecord = isRecord(event.message) ? event.message : undefined;
  const content = Array.isArray(messageRecord?.content)
    ? messageRecord.content
    : [];
  const result = stringValue(event.result);
  const text = stringValue(part?.text);
  const message = stringValue(event.message);
  const contentText = content
    .filter(isRecord)
    .map((item) =>
      stringValue(item.type) === "text" ? stringValue(item.text) : undefined,
    );
  return [result, text, message, ...contentText].filter(
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

  return calls;
}

function successfulMcpToolCallCount(toolCalls: HarnessToolCall[]): number {
  const seen = new Set<string>();

  for (const call of toolCalls) {
    if (!call.name.includes("sketchi-code-mode")) {
      continue;
    }
    if (call.status && call.status !== "completed") {
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
  return acceptedBuildResultFrom(value.result);
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

  const result = acceptedBuildResultFrom(payload);
  if (!result || payload.ok !== true) {
    return undefined;
  }

  const artifact = isRecord(result.artifact) ? result.artifact : undefined;
  const quality = isRecord(result.quality) ? result.quality : undefined;
  const artifactId = stringValue(artifact?.artifactId);
  const status = stringValue(result.status);
  const normalizedSpec = result.normalizedSpec;
  const buildOk = result.ok === true;

  if (
    !buildOk ||
    status !== "accepted" ||
    !artifactId ||
    !isRecord(normalizedSpec)
  ) {
    return undefined;
  }

  return {
    artifactId,
    ...(stringValue(result.buildId)
      ? { buildId: stringValue(result.buildId) }
      : {}),
    buildOk,
    normalizedSpec,
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

export function summarizeHarnessStdout(stdout: string): HarnessOutputSummary {
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

function outputContractErrors(input: {
  finalJson: unknown | undefined;
  proof: HarnessMcpArtifactProof | undefined;
}): string[] {
  const errors: string[] = [];

  if (!input.proof) {
    errors.push(
      "No successful sketchi-code-mode execute artifact was observed in the harness event stream.",
    );
  }

  if (!isRecord(input.finalJson)) {
    errors.push("Harness final response did not contain parseable JSON.");
    return errors;
  }

  if (input.finalJson.buildOk !== true) {
    errors.push('Final JSON must include "buildOk": true.');
  }

  if (stringValue(input.finalJson.status) !== "accepted") {
    errors.push('Final JSON must include "status": "accepted".');
  }

  const finalArtifactId = stringValue(input.finalJson.artifactId);
  if (!finalArtifactId) {
    errors.push('Final JSON must include the accepted MCP "artifactId".');
  } else if (input.proof && finalArtifactId !== input.proof.artifactId) {
    errors.push(
      `Final artifactId "${finalArtifactId}" does not match MCP artifactId "${input.proof.artifactId}".`,
    );
  }

  return errors;
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

async function runHarnessScenario(input: {
  options: HarnessEvalOptions;
  outputDir: string;
  repeat: number;
  runNumber: number;
  scenario: DiagramScenario;
}): Promise<HarnessRunReport> {
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
  });
  const result = await runCommand(command, input.options.timeoutMs);
  const summary = summarizeHarnessStdout(result.stdout);
  const mcpProof = summary.mcpArtifacts.at(-1);
  const outputErrors = outputContractErrors({
    finalJson: summary.finalJson,
    proof: mcpProof,
  });
  const artifactEvaluation = mcpProof
    ? evaluateHarnessJson(input.scenario, {
        normalizedSpec: mcpProof.normalizedSpec,
      })
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
          error: [artifactEvaluation.error, ...outputErrors]
            .filter(Boolean)
            .join(" "),
          ok: false,
        };
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

  await writeText(eventsOut, result.stdout);
  await writeText(stderrOut, result.stderr);
  await writeJson(candidateOut, {
    finalJson: summary.finalJson,
    finalText: summary.finalText,
    mcpArtifact: reportableMcpArtifact(mcpProof),
    outputContractErrors: outputErrors,
  });

  const runError = evaluation.error;

  return {
    candidateOut,
    command: redactedCommandForReport(command),
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
    }
  }

  const report = summarizeReport({
    harness: options.harness,
    mcpUrl: options.mcpUrl,
    model: options.model,
    repeat: options.repeat,
    results,
    scenarioCount: scenarios.length,
  });
  const reportOut = options.reportOut ?? path.join(outputDir, "report.json");
  await writeJson(reportOut, report);
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
