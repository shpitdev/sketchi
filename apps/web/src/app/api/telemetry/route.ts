import { createTraceId, normalizeTraceId } from "@sketchi/shared";
import { z } from "zod";

import { logApiEvent } from "@/lib/observability";

const TelemetrySchema = z
  .object({
    traceId: z.string().optional(),
    level: z.enum(["info", "warning", "error"]).optional(),
    op: z.string(),
  })
  .passthrough();

export async function POST(request: Request) {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = TelemetrySchema.safeParse(payload);
  if (!parsed.success) {
    return new Response("Invalid payload", { status: 400 });
  }

  const traceId =
    normalizeTraceId(parsed.data.traceId) ??
    normalizeTraceId(request.headers.get("x-trace-id")) ??
    createTraceId();
  const level = parsed.data.level ?? "info";

  const { level: _level, traceId: _traceId, ...extra } = parsed.data;

  await logApiEvent(
    {
      traceId,
      op: parsed.data.op,
      status: "success",
      component: "telemetry-proxy",
      requestLength: JSON.stringify(payload).length,
      ...extra,
    },
    { level }
  );

  const response = new Response(JSON.stringify({ status: "ok", traceId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  response.headers.set("x-trace-id", traceId);
  return response;
}
