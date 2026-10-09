import "@tanstack/react-start/server-only";

import { Result, Schema } from "effect";

const decodeCorrelationId = Schema.decodeUnknownResult(
  Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/)),
);

export function correlationIdHeader(
  request: Request,
  name: string,
): string | undefined {
  const decoded = decodeCorrelationId(request.headers.get(name)?.trim());
  return Result.isSuccess(decoded) ? decoded.success : undefined;
}
