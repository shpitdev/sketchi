import type { PropertyValidators, Validator } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { action } from "../_generated/server";

export interface LoggingOptions<Args, Result> {
  formatArgs?: (args: Args) => Record<string, unknown>;
  formatResult?: (result: Result) => Record<string, unknown>;
}

type ActionDefinition<Args extends object, Result> = {
  args?: PropertyValidators | Validator<any, "required", any> | void;
  returns?: PropertyValidators | Validator<any, "required", any> | void;
  handler: (ctx: ActionCtx, args: Args) => Promise<Result> | Result;
};

export function createLoggedAction<Args extends object, Result>(
  name: string,
  options: LoggingOptions<Args, Result> = {}
) {
  const { formatArgs, formatResult } = options;

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
        const loggedArgs = formatArgs
          ? formatArgs(safeArgs)
          : { _redacted: true, keys: Object.keys(safeArgs) };
        console.log("[convex.action.start]", {
          name,
          args: loggedArgs,
        });

        try {
          const result = (await handler(ctx, args as Args)) as Result;
          console.log("[convex.action.success]", {
            name,
            durationMs: Date.now() - start,
            result: formatResult ? formatResult(result) : undefined,
          });
          return result;
        } catch (error) {
          console.error("[convex.action.error]", {
            name,
            durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    } as Parameters<typeof action>[0]);
  };
}
