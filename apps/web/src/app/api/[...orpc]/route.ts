import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { captureException, withScope } from "@sentry/nextjs";
import { createTraceId, normalizeTraceId } from "@sketchi/shared";

import type { LogLevel } from "@/lib/observability";
import { getOrpcRouteTag, hashString, logApiEvent } from "@/lib/observability";
import { appRouter, createOrpcContext } from "@/lib/orpc/router";

const handler = new OpenAPIHandler(appRouter);

async function handleRequest(request: Request) {
  const start = Date.now();
  const traceId =
    normalizeTraceId(request.headers.get("x-trace-id")) ?? createTraceId();
  const url = new URL(request.url);
  const orpcRoute = getOrpcRouteTag(url.pathname);
  const requestClone = request.clone();
  let requestBody = "";
  if (request.method !== "GET") {
    try {
      requestBody = await requestClone.text();
    } catch {
      requestBody = "";
    }
  }

  let response: Response | null = null;
  let error: unknown;

  try {
    const result = await handler.handle(request, {
      prefix: "/api",
      context: createOrpcContext(request, traceId),
    });
    response = result.response ?? new Response("Not Found", { status: 404 });
  } catch (err) {
    error = err;
    response = new Response("Internal Server Error", { status: 500 });
  }

  const responseWithTrace = new Response(response.body, response);
  responseWithTrace.headers.set("x-trace-id", traceId);

  const durationMs = Date.now() - start;
  const requestHash = await hashString(requestBody);
  const requestLength = requestBody.length || undefined;
  const status = responseWithTrace.status;
  let statusType: "success" | "warning" | "failed" = "success";
  let level: LogLevel = "info";
  if (status >= 500) {
    statusType = "failed";
    level = "error";
  } else if (status >= 400) {
    statusType = "warning";
    level = "warning";
  }

  if (error) {
    withScope((scope) => {
      scope.setTag("traceId", traceId);
      if (orpcRoute) {
        scope.setTag("orpc.route", orpcRoute);
      }
      scope.setContext("orpc.request", {
        method: request.method,
        path: url.pathname,
      });
      captureException(error);
    });
  }

  await logApiEvent(
    {
      traceId,
      op: "request.complete",
      status: statusType,
      durationMs,
      requestLength,
      requestHash: requestHash ?? undefined,
      responseStatus: status,
      method: request.method,
      path: url.pathname,
      orpcRoute: orpcRoute ?? undefined,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : undefined,
    },
    { level }
  );

  return responseWithTrace;
}

export { handleRequest as GET, handleRequest as POST };
