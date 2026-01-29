import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { ParquetSchema, ParquetWriter } from "parquetjs-lite";

const PORT_START = 4900;
const PORT_END = 4919;
const HOST = "127.0.0.1";

type CliOptions = {
  port?: number;
  logDir?: string;
  projectDir?: string;
  open?: boolean;
};

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { open: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--port") {
      const value = Number.parseInt(args[i + 1] ?? "", 10);
      if (Number.isFinite(value)) {
        options.port = value;
      }
      i += 1;
    } else if (arg === "--log-dir") {
      options.logDir = args[i + 1];
      i += 1;
    } else if (arg === "--project-dir") {
      options.projectDir = args[i + 1];
      i += 1;
    } else if (arg === "--no-open") {
      options.open = false;
    }
  }
  return options;
}

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetch(`${baseUrl}/config`, {
          signal: controller.signal,
        });
        if (response.ok) {
          return;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // keep waiting
    }
    await wait(300);
  }
  throw new Error("Timed out waiting for OpenCode server to start.");
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function createWriter(outputPath: string): Promise<ParquetWriter> {
  const schema = new ParquetSchema({
    receivedAt: { type: "TIMESTAMP_MILLIS" },
    directory: { type: "UTF8", optional: true },
    eventType: { type: "UTF8", optional: true },
    eventStream: { type: "UTF8", optional: true },
    sessionID: { type: "UTF8", optional: true },
    messageID: { type: "UTF8", optional: true },
    parentMessageID: { type: "UTF8", optional: true },
    partID: { type: "UTF8", optional: true },
    partType: { type: "UTF8", optional: true },
    kind: { type: "UTF8", optional: true },
    toolName: { type: "UTF8", optional: true },
    toolStatus: { type: "UTF8", optional: true },
    toolCallID: { type: "UTF8", optional: true },
    toolStartMs: { type: "INT64", optional: true },
    toolEndMs: { type: "INT64", optional: true },
    toolDurationMs: { type: "INT64", optional: true },
    role: { type: "UTF8", optional: true },
    providerID: { type: "UTF8", optional: true },
    modelID: { type: "UTF8", optional: true },
    messageCreatedMs: { type: "INT64", optional: true },
    messageCompletedMs: { type: "INT64", optional: true },
    stepCost: { type: "DOUBLE", optional: true },
    stepStartMs: { type: "INT64", optional: true },
    stepEndMs: { type: "INT64", optional: true },
    stepDurationMs: { type: "INT64", optional: true },
    tokensInput: { type: "INT64", optional: true },
    tokensOutput: { type: "INT64", optional: true },
    tokensReasoning: { type: "INT64", optional: true },
    tokensCacheRead: { type: "INT64", optional: true },
    tokensCacheWrite: { type: "INT64", optional: true },
    traceId: { type: "UTF8", optional: true },
    data: { type: "UTF8" },
  });

  return await ParquetWriter.openFile(schema, outputPath);
}

function normalizeEvent(event: unknown): {
  directory?: string;
  payload: Record<string, unknown>;
} {
  if (!event || typeof event !== "object") {
    return { payload: { value: event } };
  }
  const record = event as Record<string, unknown>;
  const payload =
    record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : record;
  const directory =
    typeof record.directory === "string" ? record.directory : undefined;
  return { directory, payload };
}

function extractTraceId(payload: Record<string, unknown>): string | undefined {
  const candidates = [
    payload.traceId,
    payload.traceID,
    payload.trace_id,
    payload.properties && (payload.properties as Record<string, unknown>).traceId,
    payload.properties &&
      (payload.properties as Record<string, unknown>).trace_id,
    payload.properties &&
      (payload.properties as Record<string, unknown>).info &&
      (payload.properties as Record<string, unknown>).info &&
      (payload.properties as Record<string, unknown>).info?.traceId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function extractTraceIdFromOutput(output?: unknown): string | undefined {
  if (typeof output !== "string") {
    return undefined;
  }
  const trimmed = output.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const direct =
      typeof parsed.traceId === "string"
        ? parsed.traceId
        : typeof parsed.traceID === "string"
          ? parsed.traceID
          : typeof parsed.trace_id === "string"
            ? parsed.trace_id
            : undefined;
    if (direct) {
      return direct;
    }
    const stats = parsed.stats as Record<string, unknown> | undefined;
    if (stats) {
      if (typeof stats.traceId === "string") {
        return stats.traceId;
      }
      if (typeof stats.traceID === "string") {
        return stats.traceID;
      }
      if (typeof stats.trace_id === "string") {
        return stats.trace_id;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractMeta(payload: Record<string, unknown>): {
  eventType?: string;
  sessionID?: string;
  messageID?: string;
  parentMessageID?: string;
  partID?: string;
  partType?: string;
  kind?: string;
  toolName?: string;
  toolStatus?: string;
  toolCallID?: string;
  toolStartMs?: number;
  toolEndMs?: number;
  toolDurationMs?: number;
  role?: string;
  providerID?: string;
  modelID?: string;
  messageCreatedMs?: number;
  messageCompletedMs?: number;
  stepCost?: number;
  stepStartMs?: number;
  stepEndMs?: number;
  stepDurationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  traceId?: string;
} {
  const eventType =
    typeof payload.type === "string"
      ? payload.type
      : typeof payload.event === "string"
        ? payload.event
        : undefined;

  const properties =
    payload.properties && typeof payload.properties === "object"
      ? (payload.properties as Record<string, unknown>)
      : undefined;

  const sessionID =
    typeof payload.sessionID === "string"
      ? payload.sessionID
      : typeof properties?.sessionID === "string"
        ? properties.sessionID
        : typeof payload.session_id === "string"
          ? (payload.session_id as string)
          : undefined;

  const messageID =
    typeof payload.messageID === "string"
      ? payload.messageID
      : typeof properties?.messageID === "string"
        ? properties.messageID
        : typeof payload.message_id === "string"
          ? (payload.message_id as string)
          : undefined;

  let traceId = extractTraceId(payload);

  let partID: string | undefined;
  let partType: string | undefined;
  let kind: string | undefined;
  let toolName: string | undefined;
  let toolStatus: string | undefined;
  let toolCallID: string | undefined;
  let toolStartMs: number | undefined;
  let toolEndMs: number | undefined;
  let toolDurationMs: number | undefined;
  let role: string | undefined;
  let providerID: string | undefined;
  let modelID: string | undefined;
  let parentMessageID: string | undefined;
  let messageCreatedMs: number | undefined;
  let messageCompletedMs: number | undefined;
  let stepCost: number | undefined;
  let stepStartMs: number | undefined;
  let stepEndMs: number | undefined;
  let stepDurationMs: number | undefined;
  let tokensInput: number | undefined;
  let tokensOutput: number | undefined;
  let tokensReasoning: number | undefined;
  let tokensCacheRead: number | undefined;
  let tokensCacheWrite: number | undefined;

  if (eventType === "message.part.updated" && properties?.part) {
    const part = properties.part as Record<string, unknown>;
    if (typeof part.id === "string") {
      partID = part.id;
    }
    if (typeof part.type === "string") {
      partType = part.type;
      kind = part.type;
    }
    if (part.type === "tool") {
      toolName = typeof part.tool === "string" ? part.tool : undefined;
      toolCallID = typeof part.callID === "string" ? part.callID : undefined;
      if (part.state && typeof part.state === "object") {
        const state = part.state as Record<string, unknown>;
        toolStatus = typeof state.status === "string" ? state.status : undefined;
        const time = state.time as Record<string, unknown> | undefined;
        toolStartMs = typeof time?.start === "number" ? time.start : undefined;
        toolEndMs = typeof time?.end === "number" ? time.end : undefined;
        if (typeof toolStartMs === "number" && typeof toolEndMs === "number") {
          toolDurationMs = toolEndMs - toolStartMs;
        }
        if (!traceId && toolStatus === "completed") {
          const output = state.output as string | undefined;
          const parsedTrace = extractTraceIdFromOutput(output);
          if (parsedTrace) {
            traceId = parsedTrace;
          }
        }
      }
    }
    if (part.type === "step-finish") {
      const cost = part.cost as number | undefined;
      stepCost = typeof cost === "number" ? cost : undefined;
      const tokens = part.tokens as Record<string, unknown> | undefined;
      tokensInput = typeof tokens?.input === "number" ? tokens.input : undefined;
      tokensOutput =
        typeof tokens?.output === "number" ? tokens.output : undefined;
      tokensReasoning =
        typeof tokens?.reasoning === "number" ? tokens.reasoning : undefined;
      const cache = tokens?.cache as Record<string, unknown> | undefined;
      tokensCacheRead =
        typeof cache?.read === "number" ? cache.read : undefined;
      tokensCacheWrite =
        typeof cache?.write === "number" ? cache.write : undefined;
      const time = part.time as Record<string, unknown> | undefined;
      stepStartMs = typeof time?.start === "number" ? time.start : undefined;
      stepEndMs = typeof time?.end === "number" ? time.end : undefined;
      if (typeof stepStartMs === "number" && typeof stepEndMs === "number") {
        stepDurationMs = stepEndMs - stepStartMs;
      }
    }
  }

  if (eventType === "message.updated" && properties?.info) {
    const info = properties.info as Record<string, unknown>;
    role = typeof info.role === "string" ? info.role : undefined;
    providerID =
      typeof info.providerID === "string" ? info.providerID : undefined;
    modelID = typeof info.modelID === "string" ? info.modelID : undefined;
    parentMessageID =
      typeof info.parentID === "string" ? info.parentID : undefined;
    const time = info.time as Record<string, unknown> | undefined;
    messageCreatedMs =
      typeof time?.created === "number" ? time.created : undefined;
    messageCompletedMs =
      typeof time?.completed === "number" ? time.completed : undefined;
  }

  return {
    eventType,
    sessionID,
    messageID,
    partID,
    partType,
    kind,
    toolName,
    toolStatus,
    toolCallID,
    toolStartMs,
    toolEndMs,
    toolDurationMs,
    role,
    providerID,
    modelID,
    parentMessageID,
    messageCreatedMs,
    messageCompletedMs,
    stepCost,
    stepStartMs,
    stepEndMs,
    stepDurationMs,
    tokensInput,
    tokensOutput,
    tokensReasoning,
    tokensCacheRead,
    tokensCacheWrite,
    traceId,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = options.port ?? (await findOpenPort());
  const baseUrl = `http://${HOST}:${port}`;
  const projectDir = options.projectDir
    ? resolve(process.cwd(), options.projectDir)
    : process.cwd();
  const logRoot = resolve(projectDir, "sketchi");
  const logDir = options.logDir
    ? isAbsolute(options.logDir)
      ? options.logDir
      : resolve(logRoot, options.logDir)
    : resolve(logRoot, "opencode-logs");

  await mkdir(logDir, { recursive: true });
  const logPath = resolve(
    logDir,
    `opencode-events-${formatTimestamp(new Date())}.parquet`
  );

  const command = options.open ? "web" : "serve";
  console.log(`OpenCode command: opencode ${command} --port ${port}`);
  console.log(`OpenCode URL: ${baseUrl}`);
  console.log(`Parquet log: ${logPath}`);
  const child = Bun.spawn({
    cmd: ["opencode", command, "--port", String(port), "--hostname", HOST],
    stdout: "inherit",
    stderr: "inherit",
    cwd: projectDir,
  });

  await waitForServer(baseUrl);

  const client = createOpencodeClient({ baseUrl });
  const abortController = new AbortController();
  const writer = await createWriter(logPath);
  let shuttingDown = false;
  let appendChain = Promise.resolve();

  const eventStreams: Array<{
    stream: AsyncIterable<unknown>;
    name: string;
  }> = [];

  const globalEvents = await client.global.event({
    signal: abortController.signal,
  });
  eventStreams.push({ name: "global", stream: globalEvents.stream });

  try {
    const localEvents = await client.event.subscribe({
      query: { directory: projectDir },
      signal: abortController.signal,
    });
    eventStreams.push({ name: "event", stream: localEvents.stream });
  } catch (error) {
    console.error(
      `Failed to subscribe to /event stream: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const appendRow = async (row: Record<string, unknown>) => {
    appendChain = appendChain.then(() => writer.appendRow(row));
    await appendChain;
  };

  const logLoops = eventStreams.map(({ name, stream }) =>
    (async () => {
      try {
        for await (const event of stream) {
          if (shuttingDown) {
            break;
          }
          const normalized = normalizeEvent(event);
          const meta = extractMeta(normalized.payload);
          const data = JSON.stringify(
            {
              directory: normalized.directory,
              payload: normalized.payload,
            },
            null,
            0
          );
          await appendRow({
            receivedAt: Date.now(),
            directory: normalized.directory,
            eventType: meta.eventType,
            eventStream: name,
            sessionID: meta.sessionID,
            messageID: meta.messageID,
            parentMessageID: meta.parentMessageID,
            partID: meta.partID,
            partType: meta.partType,
            kind: meta.kind,
            toolName: meta.toolName,
            toolStatus: meta.toolStatus,
            toolCallID: meta.toolCallID,
            toolStartMs: meta.toolStartMs,
            toolEndMs: meta.toolEndMs,
            toolDurationMs: meta.toolDurationMs,
            role: meta.role,
            providerID: meta.providerID,
            modelID: meta.modelID,
            messageCreatedMs: meta.messageCreatedMs,
            messageCompletedMs: meta.messageCompletedMs,
            stepCost: meta.stepCost,
            stepStartMs: meta.stepStartMs,
            stepEndMs: meta.stepEndMs,
            stepDurationMs: meta.stepDurationMs,
            tokensInput: meta.tokensInput,
            tokensOutput: meta.tokensOutput,
            tokensReasoning: meta.tokensReasoning,
            tokensCacheRead: meta.tokensCacheRead,
            tokensCacheWrite: meta.tokensCacheWrite,
            traceId: meta.traceId,
            data,
          });
        }
      } catch (error) {
        if (!shuttingDown) {
          console.error(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    })()
  );

  const shutdown = async (code = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    abortController.abort();
    await Promise.all(logLoops.map((loop) => loop.catch(() => {})));
    await appendChain.catch(() => {});
    try {
      await writer.close();
    } catch {
      // ignore double-close
    }
    if (!child.killed) {
      child.kill("SIGINT");
    }
    process.exit(code);
  };

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });

  const exitCode = await child.exited;
  await shutdown(exitCode ?? 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
