import "@tanstack/react-start/server-only";

import { type ClientLimitDecision, takeClientRequest } from "@sketchi/community-icons";
import { DurableObject } from "cloudflare:workers";

/**
 * One client address's recent requests, for an exact per-client limit. The Worker names one
 * object per address, so concurrent requests from that address are counted one at a time.
 */
export class ClientRateLimit extends DurableObject {
	async take(limit: number, windowMs: number): Promise<ClientLimitDecision> {
		const now = Date.now();
		const decision = await takeClientRequest(this.ctx.storage, limit, windowMs, now);
		// Once a window passes without a request there is nothing left to count.
		if (decision.allowed) await this.ctx.storage.setAlarm(now + windowMs);
		return decision;
	}

	async alarm(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}
}
