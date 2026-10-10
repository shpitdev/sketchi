import { Schema } from "effect";

const R2_SQL_API_BASE = "https://api.sql.cloudflarestorage.com/api/v1";
const DEFAULT_TOKEN_ENV = "WRANGLER_R2_SQL_AUTH_TOKEN";

export class R2SqlQueryError extends Schema.TaggedError<R2SqlQueryError>()("R2SqlQueryError", {
	cause: Schema.optionalKey(Schema.Defect()),
	message: Schema.String,
	retryable: Schema.Boolean,
	retryAfterMs: Schema.optionalKey(Schema.Number),
	status: Schema.optionalKey(Schema.Number),
}) {}

export function isTransientHttpStatus(status: number) {
	return status === 404 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

// Retry-After accepts either delta-seconds or an HTTP date. Keep parsing pure so
// Effect callers use their clock and Node callers use the host clock.
export function retryAfterDelayMs(value: string | null, nowMs: number): number | undefined {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	if (/^\d+$/.test(normalized)) {
		return Math.min(Number(normalized) * 1000, Number.MAX_SAFE_INTEGER);
	}
	const timestamp = Date.parse(normalized);
	return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : undefined;
}

export function pollRetryDelayMs(
	error: unknown,
	delayMs: number,
	attemptTimeoutMs: number,
): number {
	if (!(error instanceof R2SqlQueryError) || error.retryAfterMs === undefined) return delayMs;
	return Math.min(attemptTimeoutMs, Math.max(delayMs, error.retryAfterMs));
}

export function sqlStringLiteral(value: unknown) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

export function r2SqlApiUrl(accountId: string, bucket: string) {
	return `${R2_SQL_API_BASE}/accounts/${accountId}/r2-sql/query/${bucket}`;
}

export function isR2SqlSuccess(responseBody: unknown) {
	return Schema.is(Schema.Struct({ success: Schema.Literal(true) }))(responseBody);
}

export function r2SqlErrorSummary(responseBody: unknown) {
	const errorResponse = Schema.Struct({
		errors: Schema.Array(
			Schema.Struct({
				code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
				message: Schema.optionalKey(Schema.String),
			}),
		),
	});
	if (!Schema.is(errorResponse)(responseBody) || responseBody.errors.length === 0) {
		return "unknown R2 SQL error";
	}
	return responseBody.errors
		.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "unknown"}`)
		.join("; ");
}

export function requireToken(env: NodeJS.ProcessEnv, tokenEnv: string = DEFAULT_TOKEN_ENV) {
	const token = env[tokenEnv]?.trim();
	if (!token) {
		throw new Error(
			`${tokenEnv} is required. Use an R2 API token with Admin Read & Write permissions; Wrangler OAuth tokens can list catalog metadata but are not a reliable catalog sink or R2 SQL data-scan credential.`,
		);
	}
	return token;
}
