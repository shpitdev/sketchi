import { Schema } from "effect";

// @effect-diagnostics-next-line schemaSync:off -- Test assertions synchronously inspect exported browser artifact JSON independently of its encoder.
export const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
