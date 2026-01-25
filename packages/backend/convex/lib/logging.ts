import { customAction } from "convex-helpers/server/customFunctions";
import { action } from "../_generated/server";

export interface LoggingOptions<Args, Result> {
  formatArgs?: (args: Args) => Record<string, unknown>;
  formatResult?: (result: Result) => Record<string, unknown>;
}

export function createLoggedAction<
  Args extends Record<string, unknown>,
  Result,
>(name: string, options: LoggingOptions<Args, Result> = {}) {
  const { formatArgs, formatResult } = options;
  const builder = customAction(action, {
    input: async (ctx, args) => ({ ctx, args }),
  });

  return (definition: Parameters<typeof builder>[0]) =>
    builder({
      ...definition,
      handler: async (ctx, args) => {
        const start = Date.now();
        const safeArgs = (args ?? {}) as Args;
        console.log("[convex.action.start]", {
          name,
          args: formatArgs ? formatArgs(safeArgs) : safeArgs,
        });

        try {
          const result = (await definition.handler(ctx, args)) as Result;
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
    });
}
