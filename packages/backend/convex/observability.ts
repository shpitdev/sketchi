"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { flushSentry, logEvent, startSentrySpan } from "./lib/observability";
import { createTraceId } from "./lib/trace";

export const sentrySmokeTest = action({
  args: {
    message: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const traceId = createTraceId();
    const message = args.message ?? "convex.sentrySmokeTest";

    await logEvent({
      traceId,
      actionName: "sentrySmokeTest",
      op: "sentry.smoke",
      stage: "telemetry",
      status: "success",
      message,
    });

    await startSentrySpan(
      {
        name: "convex.sentrySmokeTest",
        op: "test",
        attributes: { traceId },
      },
      async () => {
        await logEvent({
          traceId,
          actionName: "sentrySmokeTest",
          op: "sentry.span",
          stage: "telemetry",
          status: "success",
        });
      }
    );

    await flushSentry(2000);

    return {
      status: "ok",
      traceId,
      message,
    };
  },
});
