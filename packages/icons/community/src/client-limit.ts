/**
 * An exact per-client request limit: one Durable Object per client address keeps the times of
 * that client's recent requests, so a client that sends more than `limit` in any `windowMs`
 * is refused until its oldest one leaves the window. Workers' rate-limit binding is eventually
 * consistent and was seen never to refuse; this one counts every request.
 */

export interface ClientLimitDecision {
	readonly allowed: boolean;
	/** Whole seconds until the client may send again; 0 when allowed. */
	readonly retryAfterSeconds: number;
}

/** The storage one client's limit object reads and writes. */
export interface ClientLimitStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
}

/** A client-limit Durable Object namespace, narrowed to what a Worker calls. */
export interface ClientLimitNamespace {
	getByName(name: string): {
		take(limit: number, windowMs: number): Promise<ClientLimitDecision>;
	};
}

const REQUESTS = "requests";

/**
 * Count one request at `now` in a sliding window: allowed while fewer than `limit` allowed
 * requests fall within the last `windowMs`. A refused request is not counted, so a client that
 * keeps retrying is let in as soon as its oldest request ages out.
 */
export async function takeClientRequest(
	storage: ClientLimitStorage,
	limit: number,
	windowMs: number,
	now: number,
): Promise<ClientLimitDecision> {
	const recent = ((await storage.get<number[]>(REQUESTS)) ?? []).filter(
		(time) => time > now - windowMs && time <= now,
	);
	if (recent.length >= limit) {
		const oldest = Math.min(...recent);
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
		};
	}
	await storage.put(REQUESTS, [...recent, now]);
	return { allowed: true, retryAfterSeconds: 0 };
}

/** The address a request came from, as Cloudflare reports it. */
export function clientAddress(request: Request): string {
	return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** Ask the requesting client's own limit object whether it may send this request. */
export function limitClient(
	namespace: ClientLimitNamespace,
	request: Request,
	limit: number,
	windowMs: number,
): Promise<ClientLimitDecision> {
	return namespace.getByName(`client:${clientAddress(request)}`).take(limit, windowMs);
}
