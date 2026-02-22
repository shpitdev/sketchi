"use node";

import type { PropertyValidators, Validator } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { action } from "../_generated/server";
import { logEventSafely } from "./observability";
import { createTraceId } from "./trace";

export interface LoggingOptions<Args, Result> {
  formatArgs?: (args: Args) => Record<string, unknown>;
  formatResult?: (result: Result) => Record<string, unknown>;
  getTraceId?: (args: Args, result?: Result) => string | undefined;
}

interface ActionDefinition<Args extends object, Result> {
  args?: PropertyValidators | Validator<unknown, "required", string>;
  handler: (ctx: ActionCtx, args: Args) => Promise<Result> | Result;
  returns?: PropertyValidators | Validator<unknown, "required", string>;
}

function resolveTraceId<Args extends object, Result>(
  args: Args,
  getTraceId?: (args: Args, result?: Result) => string | undefined
): string {
  const fromCallback = getTraceId?.(args);
  if (fromCallback) {
    return fromCallback;
  }
  const direct = (args as { traceId?: unknown }).traceId;
  if (typeof direct === "string") {
    return direct;
  }
  return createTraceId();
}

function formatArgsForLog<Args extends object>(
  args: Args,
  formatArgs?: (args: Args) => Record<string, unknown>
): Record<string, unknown> {
  if (formatArgs) {
    return formatArgs(args);
  }
  return { _redacted: true, keys: Object.keys(args ?? {}) };
}

function formatResultForLog<Result>(
  result: Result,
  formatResult?: (result: Result) => Record<string, unknown>
): Record<string, unknown> | undefined {
  return formatResult ? formatResult(result) : undefined;
}

export function createLoggedAction<Args extends object, Result>(
  name: string,
  options: LoggingOptions<Args, Result> = {}
) {
  const { formatArgs, formatResult, getTraceId } = options;

  return (definition: ActionDefinition<Args, Result>) => {
    const handler = definition.handler as (
      ctx: ActionCtx,
      args: Args
    ) => Promise<Result>;

    return action({
      ...definition,
      handler: async (ctx, args) => {
        const start = Date.now();
        const safeArgs = (args ?? {}) as Args;
        const loggedArgs = formatArgsForLog(safeArgs, formatArgs);
        const traceId = resolveTraceId<Args, Result>(safeArgs, getTraceId);
        logEventSafely({
          traceId,
          actionName: name,
          op: "action.start",
          stage: "convex.action",
          args: loggedArgs,
        });

        try {
          const result = (await handler(ctx, args as Args)) as Result;
          const loggedResult = formatResultForLog(result, formatResult);
          logEventSafely({
            traceId,
            actionName: name,
            op: "action.complete",
            stage: "convex.action",
            status: "success",
            durationMs: Date.now() - start,
            result: loggedResult,
          });
          return result;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logEventSafely(
            {
              traceId,
              actionName: name,
              op: "action.error",
              stage: "convex.action",
              status: "failed",
              durationMs: Date.now() - start,
              errorName: error instanceof Error ? error.name : undefined,
              errorMessage: message,
            },
            { level: "error" }
          );
          throw error;
        }
      },
    } as Parameters<typeof action>[0]);
  };
}
