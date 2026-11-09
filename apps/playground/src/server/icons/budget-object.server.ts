import "@tanstack/react-start/server-only";

import { DurableObject } from "cloudflare:workers";

/** Plain data so it crosses Durable Object RPC intact. */
export interface IconDrawAdmission {
	readonly admitted: boolean;
	/** Draws counted today, this one included when admitted. */
	readonly used: number;
}

/** The `ICON_DRAW_BUDGET` namespace, narrowed to what the Worker calls. */
export interface IconDrawBudgetNamespace {
	getByName(name: string): { admit(cap: number): Promise<IconDrawAdmission> };
}

const PREFIX = "draws:";

/** The UTC day a moment falls on, as the storage key's suffix: `2026-11-09`. */
function utcDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

/**
 * Counts icon draws per UTC day across every client, so the public draw endpoint's model spend
 * has a ceiling. One instance holds the count and reads the day from its own clock, so a call
 * that reaches it late never counts against a day that has ended. Storage reads and writes within
 * one call cannot interleave with another call's, so two draws never take the last slot.
 */
export class IconDrawBudget extends DurableObject {
	async admit(cap: number): Promise<IconDrawAdmission> {
		const today = `${PREFIX}${utcDay(Date.now())}`;
		const days = [...(await this.ctx.storage.list<number>({ prefix: PREFIX })).entries()];
		// A clock that steps back must not reopen a day, nor touch the count of a later one.
		const later = days.find(([key]) => key > today);
		if (later) return { admitted: false, used: later[1] };
		const used = days.find(([key]) => key === today)?.[1] ?? 0;
		if (used >= cap) return { admitted: false, used };
		await this.ctx.storage.put(today, used + 1);
		// Earlier days' counts are never read again.
		const earlier = days.map(([key]) => key).filter((key) => key < today);
		if (earlier.length > 0) await this.ctx.storage.delete(earlier);
		return { admitted: true, used: used + 1 };
	}
}
