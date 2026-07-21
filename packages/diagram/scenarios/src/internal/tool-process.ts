import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

import { Clock, Context, Effect, Layer, Schema, Scope } from "effect";

export interface ToolProcessSpec {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly shell?: boolean;
  readonly stdin?: string;
}

export interface ToolProcessTerminal {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface ToolProcessOutput {
  readonly stderr: string;
  readonly stdout: string;
}

export interface ToolProcessResult
  extends ToolProcessOutput,
    ToolProcessTerminal {
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface ToolProcessPolicy {
  readonly closeGraceMs: number;
  readonly forceSettleGraceMs: number;
  readonly hardKillGraceMs: number;
  readonly timeoutMs: number;
}

export class ToolProcessPolicyError extends Schema.TaggedErrorClass<ToolProcessPolicyError>()(
  "ToolProcessPolicyError",
  {
    field: Schema.String,
    message: Schema.String,
    value: Schema.Number,
  },
) {}

export class ToolProcessSpawnError extends Schema.TaggedErrorClass<ToolProcessSpawnError>()(
  "ToolProcessSpawnError",
  {
    cause: Schema.Defect(),
    command: Schema.String,
    message: Schema.String,
  },
) {}

export class ToolProcessControlError extends Schema.TaggedErrorClass<ToolProcessControlError>()(
  "ToolProcessControlError",
  {
    cause: Schema.Defect(),
    command: Schema.String,
    message: Schema.String,
    signal: Schema.String,
  },
) {}

export class ToolProcessExitError extends Schema.TaggedErrorClass<ToolProcessExitError>()(
  "ToolProcessExitError",
  {
    command: Schema.String,
    exitCode: Schema.NullOr(Schema.Int),
    message: Schema.String,
    signal: Schema.NullOr(Schema.String),
    stderr: Schema.String,
  },
) {}

export interface RunningToolProcess {
  readonly awaitClose: Effect.Effect<
    ToolProcessTerminal,
    ToolProcessSpawnError
  >;
  readonly awaitExit: Effect.Effect<ToolProcessTerminal, ToolProcessSpawnError>;
  readonly kill: (
    signal: NodeJS.Signals,
  ) => Effect.Effect<boolean, ToolProcessControlError>;
  readonly output: Effect.Effect<ToolProcessOutput>;
}

export class ToolProcessSpawner extends Context.Service<
  ToolProcessSpawner,
  {
    readonly spawn: (
      spec: ToolProcessSpec,
    ) => Effect.Effect<RunningToolProcess, ToolProcessSpawnError, Scope.Scope>;
  }
>()("ToolProcessSpawner") {}

type ProcessEvent =
  | { readonly _tag: "Failure"; readonly error: ToolProcessSpawnError }
  | { readonly _tag: "Terminal"; readonly terminal: ToolProcessTerminal };

type ProcessSubscriber = (event: ProcessEvent) => void;

interface NodeProcessState {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closeSubscribers: Set<ProcessSubscriber>;
  readonly command: string;
  readonly exitSubscribers: Set<ProcessSubscriber>;
  readonly processGroupId: number | undefined;
  readonly stderr: Buffer[];
  readonly stdout: Buffer[];
  closeEvent: ProcessEvent | undefined;
  exitEvent: ProcessEvent | undefined;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : fallback;
}

function notify(
  subscribers: Set<ProcessSubscriber>,
  event: ProcessEvent,
): void {
  for (const subscriber of subscribers) {
    subscriber(event);
  }
  subscribers.clear();
}

function waitForEvent(
  current: () => ProcessEvent | undefined,
  subscribers: Set<ProcessSubscriber>,
): Effect.Effect<ToolProcessTerminal, ToolProcessSpawnError> {
  return Effect.callback((resume) => {
    const event = current();
    if (event) {
      resume(
        event._tag === "Failure"
          ? Effect.fail(event.error)
          : Effect.succeed(event.terminal),
      );
      return;
    }

    const subscriber: ProcessSubscriber = (nextEvent) => {
      resume(
        nextEvent._tag === "Failure"
          ? Effect.fail(nextEvent.error)
          : Effect.succeed(nextEvent.terminal),
      );
    };
    subscribers.add(subscriber);
    return Effect.sync(() => {
      subscribers.delete(subscriber);
    });
  });
}

function makeNodeProcessState(spec: ToolProcessSpec): NodeProcessState {
  const ownsProcessGroup = process.platform !== "win32";
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    detached: ownsProcessGroup,
    env: spec.env,
    shell: spec.shell ?? false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state: NodeProcessState = {
    child,
    closeSubscribers: new Set(),
    command: spec.command,
    exitSubscribers: new Set(),
    processGroupId: ownsProcessGroup ? child.pid : undefined,
    stderr: [],
    stdout: [],
    closeEvent: undefined,
    exitEvent: undefined,
  };

  child.stdout.on("data", (chunk: Buffer) => state.stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => state.stderr.push(chunk));
  child.on("error", (cause) => {
    const error = ToolProcessSpawnError.make({
      cause,
      command: spec.command,
      message: errorMessage(cause, `Unable to start ${spec.command}.`),
    });
    const event: ProcessEvent = { _tag: "Failure", error };
    state.exitEvent ??= event;
    state.closeEvent ??= event;
    notify(state.exitSubscribers, event);
    notify(state.closeSubscribers, event);
  });
  child.on("exit", (exitCode, signal) => {
    const event: ProcessEvent = {
      _tag: "Terminal",
      terminal: { exitCode, signal },
    };
    state.exitEvent ??= event;
    notify(state.exitSubscribers, state.exitEvent);
  });
  child.on("close", (exitCode, signal) => {
    const event: ProcessEvent = {
      _tag: "Terminal",
      terminal: { exitCode, signal },
    };
    state.exitEvent ??= event;
    state.closeEvent ??= event;
    notify(state.exitSubscribers, state.exitEvent);
    notify(state.closeSubscribers, event);
  });
  child.stdin.end(spec.stdin);

  return state;
}

function errorCode(cause: unknown): string | undefined {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("code" in cause) ||
    typeof cause.code !== "string"
  ) {
    return undefined;
  }
  return cause.code;
}

function signalNodeProcessTree(
  state: NodeProcessState,
  signal: NodeJS.Signals,
): boolean {
  const pid = state.child.pid;
  if (pid === undefined) return false;

  if (process.platform === "win32") {
    const result = spawnSync(
      "taskkill",
      ["/pid", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status === 0) return true;
    if (state.closeEvent !== undefined) return false;
    throw new Error(
      `taskkill could not send ${signal} to process tree ${String(pid)}.`,
    );
  }

  const processGroupId = state.processGroupId;
  if (processGroupId === undefined) return state.child.kill(signal);
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (cause) {
    if (errorCode(cause) === "ESRCH") {
      return state.child.kill(signal);
    }
    throw cause;
  }
}

function makeRunningToolProcess(state: NodeProcessState): RunningToolProcess {
  return {
    awaitClose: waitForEvent(() => state.closeEvent, state.closeSubscribers),
    awaitExit: waitForEvent(() => state.exitEvent, state.exitSubscribers),
    kill: (signal) =>
      Effect.try({
        try: () => signalNodeProcessTree(state, signal),
        catch: (cause) =>
          ToolProcessControlError.make({
            cause,
            command: state.command,
            message: errorMessage(
              cause,
              `Unable to send ${signal} to ${state.command}.`,
            ),
            signal,
          }),
      }),
    output: Effect.sync(() => ({
      stderr: Buffer.concat(state.stderr).toString("utf8"),
      stdout: Buffer.concat(state.stdout).toString("utf8"),
    })),
  };
}

function releaseNodeProcess(state: NodeProcessState): Effect.Effect<void> {
  const forceKill =
    state.processGroupId !== undefined || state.closeEvent === undefined
      ? Effect.try({
          try: () => signalNodeProcessTree(state, "SIGKILL"),
          catch: (cause) =>
            ToolProcessControlError.make({
              cause,
              command: state.command,
              message: errorMessage(
                cause,
                `Unable to send SIGKILL to ${state.command}.`,
              ),
              signal: "SIGKILL",
            }),
        }).pipe(Effect.ignore)
      : Effect.void;

  return forceKill.pipe(
    Effect.andThen(
      Effect.sync(() => {
        state.child.stdout.destroy();
        state.child.stderr.destroy();
        state.closeSubscribers.clear();
        state.exitSubscribers.clear();
      }),
    ),
  );
}

export const ToolProcessSpawnerLive = Layer.succeed(ToolProcessSpawner, {
  spawn: (spec) =>
    Effect.acquireRelease(
      Effect.try({
        try: () => makeNodeProcessState(spec),
        catch: (cause) =>
          ToolProcessSpawnError.make({
            cause,
            command: spec.command,
            message: errorMessage(cause, `Unable to start ${spec.command}.`),
          }),
      }),
      releaseNodeProcess,
    ).pipe(Effect.map(makeRunningToolProcess)),
});

function validatePolicy(
  policy: ToolProcessPolicy,
): Effect.Effect<void, ToolProcessPolicyError> {
  for (const [field, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return Effect.fail(
        ToolProcessPolicyError.make({
          field,
          message: `${field} must be a non-negative safe integer.`,
          value,
        }),
      );
    }
  }
  if (policy.timeoutMs === 0) {
    return Effect.fail(
      ToolProcessPolicyError.make({
        field: "timeoutMs",
        message: "timeoutMs must be greater than zero.",
        value: policy.timeoutMs,
      }),
    );
  }
  return Effect.void;
}

function awaitSettled(
  process: RunningToolProcess,
  closeGraceMs: number,
): Effect.Effect<ToolProcessTerminal, ToolProcessSpawnError> {
  const afterExit = process.awaitExit.pipe(
    Effect.flatMap((terminal) =>
      process.awaitClose.pipe(
        Effect.raceFirst(Effect.sleep(closeGraceMs).pipe(Effect.as(terminal))),
      ),
    ),
  );
  return process.awaitClose.pipe(Effect.raceFirst(afterExit));
}

function terminateProcess(
  process: RunningToolProcess,
  policy: ToolProcessPolicy,
): Effect.Effect<
  ToolProcessTerminal,
  ToolProcessControlError | ToolProcessSpawnError
> {
  const forceSettled: ToolProcessTerminal = {
    exitCode: null,
    signal: null,
  };

  return process
    .kill("SIGTERM")
    .pipe(
      Effect.andThen(
        awaitSettled(process, policy.closeGraceMs).pipe(
          Effect.raceFirst(
            Effect.sleep(policy.hardKillGraceMs).pipe(
              Effect.andThen(process.kill("SIGKILL")),
              Effect.andThen(
                awaitSettled(process, policy.closeGraceMs).pipe(
                  Effect.raceFirst(
                    Effect.sleep(policy.forceSettleGraceMs).pipe(
                      Effect.as(forceSettled),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
}

interface TimedProcessTerminal {
  readonly terminal: ToolProcessTerminal;
  readonly timedOut: boolean;
}

type ProcessDeadline =
  | { readonly _tag: "Completed"; readonly terminal: ToolProcessTerminal }
  | { readonly _tag: "TimedOut" };

export const runToolProcess = Effect.fn("diagramScenarios.runToolProcess")(
  function* (spec: ToolProcessSpec, policy: ToolProcessPolicy) {
    yield* validatePolicy(policy);
    const spawner = yield* ToolProcessSpawner;

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const process = yield* spawner.spawn(spec);
        const settled = yield* Effect.gen(function* () {
          const deadline = yield* process.awaitExit.pipe(
            Effect.map(
              (terminal): ProcessDeadline => ({
                _tag: "Completed",
                terminal,
              }),
            ),
            Effect.raceFirst(
              Effect.sleep(policy.timeoutMs).pipe(
                Effect.as<ProcessDeadline>({ _tag: "TimedOut" }),
              ),
            ),
          );
          if (deadline._tag === "Completed") {
            const terminal = yield* awaitSettled(process, policy.closeGraceMs);
            return {
              terminal,
              timedOut: false,
            } satisfies TimedProcessTerminal;
          }
          const terminal = yield* terminateProcess(process, policy);
          return { terminal, timedOut: true } satisfies TimedProcessTerminal;
        }).pipe(
          Effect.onInterrupt(() =>
            terminateProcess(process, policy).pipe(Effect.ignore),
          ),
        );
        const output = yield* process.output;
        const finishedAt = yield* Clock.currentTimeMillis;

        return {
          ...output,
          ...settled.terminal,
          durationMs: Math.max(0, finishedAt - startedAt),
          timedOut: settled.timedOut,
        };
      }),
    );
  },
);

export function requireSuccessfulToolProcess(
  spec: ToolProcessSpec,
  result: ToolProcessResult,
): Effect.Effect<string, ToolProcessExitError> {
  if (result.exitCode === 0 && result.signal === null && !result.timedOut) {
    return Effect.succeed(result.stdout);
  }

  const exitDescription = result.timedOut
    ? "timed out"
    : result.signal
      ? `was terminated by ${result.signal}`
      : `exited with ${result.exitCode}`;
  return Effect.fail(
    ToolProcessExitError.make({
      command: spec.command,
      exitCode: result.exitCode,
      message: `Generator command ${exitDescription}.\n${result.stderr}`,
      signal: result.signal,
      stderr: result.stderr,
    }),
  );
}
