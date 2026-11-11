import type { UIMessage } from "ai";

/** The most messages one Studio chat request may carry. */
export const MAX_CHAT_MESSAGES = 64;
/** The most characters one Studio chat request's messages may serialize to, tool payloads included. */
export const MAX_CHAT_TOTAL_CHARACTERS = 32_000;

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** The most logo slugs one build result carries forward. */
const MAX_BUILD_LOGOS = 32;

function collectIconSlugs(value: unknown, slugs: Set<string>): void {
	if (slugs.size >= MAX_BUILD_LOGOS) return;
	if (Array.isArray(value)) {
		for (const item of value) collectIconSlugs(item, slugs);
		return;
	}
	const object = record(value);
	if (!object) return;
	for (const [key, item] of Object.entries(object)) {
		if (key === "icon") {
			const slug = typeof item === "string" ? item : record(item)?.["slug"];
			if (typeof slug === "string" && slug !== "" && slugs.size < MAX_BUILD_LOGOS) slugs.add(slug);
		} else collectIconSlugs(item, slugs);
	}
}

/**
 * The logo slugs an accepted build drew: its compact result's `logos`, or the icons its
 * normalized spec places. Each was grounded in what the user named when the build ran.
 */
export function buildLogoSlugs(output: unknown): string[] {
	const result = record(output);
	if (result?.["ok"] !== true) return [];
	const logos = result["logos"];
	if (Array.isArray(logos)) {
		return logos
			.filter((slug): slug is string => typeof slug === "string" && slug !== "")
			.slice(0, MAX_BUILD_LOGOS);
	}
	const slugs = new Set<string>();
	collectIconSlugs(result["normalizedSpec"], slugs);
	return [...slugs];
}

/** The logo slugs the conversation's accepted builds drew, which later edits may keep. */
export function savedLogoSlugs(messages: readonly UIMessage[]): string[] {
	const slugs = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type.startsWith("tool-") && "output" in part) {
				for (const slug of buildLogoSlugs(part.output)) slugs.add(slug);
			}
		}
	}
	return [...slugs];
}

/**
 * What the server reads of an earlier build: whether it was accepted, its ids, its issues, the
 * quality checks it failed and the logos it drew. The scene, its files, the format links and the
 * normalized spec stay with the client, which renders them; the build's own spec stays in the
 * tool call's input.
 */
export function compactBuildOutput(output: unknown): unknown {
	const result = record(output);
	if (!result || typeof result["ok"] !== "boolean") return output;
	const artifactId = record(result["artifact"])?.["artifactId"];
	const quality = record(result["quality"]);
	const checks = quality?.["checks"];
	const logos = buildLogoSlugs(output);
	return {
		ok: result["ok"],
		...(typeof result["status"] === "string" ? { status: result["status"] } : {}),
		...(typeof result["buildId"] === "string" ? { buildId: result["buildId"] } : {}),
		...(typeof artifactId === "string" ? { artifact: { artifactId } } : {}),
		issues: Array.isArray(result["issues"]) ? result["issues"] : [],
		...(quality && typeof quality["accepted"] === "boolean"
			? {
					quality: {
						accepted: quality["accepted"],
						...(typeof quality["score"] === "number" ? { score: quality["score"] } : {}),
						...(typeof quality["threshold"] === "number"
							? { threshold: quality["threshold"] }
							: {}),
						checks: Array.isArray(checks)
							? checks.filter((check) => record(check)?.["passed"] === false)
							: [],
					},
				}
			: {}),
		...(logos.length > 0 ? { logos } : {}),
	};
}

function compactMessage<Message extends UIMessage>(message: Message): Message {
	if (message.role !== "assistant") return message;
	return {
		...message,
		parts: message.parts.map((part) =>
			part.type.startsWith("tool-") && "output" in part && part.output !== undefined
				? { ...part, output: compactBuildOutput(part.output) }
				: part,
		),
	};
}

function isSavedBuildPart(part: UIMessage["parts"][number]): boolean {
	return part.type.startsWith("tool-") && "output" in part && record(part.output)?.["ok"] === true;
}

function savedBuild(message: UIMessage): boolean {
	return message.role === "assistant" && message.parts.some(isSavedBuildPart);
}

/** An exchange cut to the diagram it saved: the reply's last accepted build call and its result. */
function savedBuildOnly<Message extends UIMessage>(exchange: readonly Message[]): Message[] {
	const reply = exchange.findLast(savedBuild);
	const part = reply?.parts.findLast(isSavedBuildPart);
	return reply && part ? [{ ...reply, parts: [part] }] : [];
}

function size(messages: readonly UIMessage[]): number {
	return JSON.stringify(messages).length;
}

/**
 * The messages a Studio chat request sends: each earlier build as its compact result, and only
 * as many of the latest exchanges as the request limits hold. An exchange is a user message and
 * the replies after it; older exchanges are dropped first, and the latest one always goes, so a
 * request too large on its own still reaches the server, which says so. When the exchange that
 * saved the latest diagram does not fit whole, its build call and result still go ahead of the
 * newer exchanges, within the same limits: every edit sends its diagram's complete spec and
 * builds on that one, and the result carries the logos it drew.
 */
export function studioChatRequestMessages<Message extends UIMessage>(
	messages: readonly Message[],
): Message[] {
	const compact = messages.map(compactMessage);
	const exchanges: Message[][] = [];
	for (const message of compact) {
		const current = exchanges.at(-1);
		if (message.role === "user" || !current) exchanges.push([message]);
		else current.push(message);
	}
	const latestSave = exchanges.findLastIndex((exchange) => exchange.some(savedBuild));
	const pinned = latestSave >= 0 ? savedBuildOnly(exchanges[latestSave] ?? []) : [];
	const fits = (kept: readonly Message[][]) => {
		const flat = kept.flat();
		return flat.length <= MAX_CHAT_MESSAGES && size(flat) <= MAX_CHAT_TOTAL_CHARACTERS;
	};
	let kept: Message[][] = [];
	let oldest = exchanges.length;
	for (let index = exchanges.length - 1; index >= 0; index -= 1) {
		const candidate = [exchanges[index] ?? [], ...kept];
		// Room stays for the saved diagram while it is older than every exchange kept.
		const tried = latestSave < index ? [pinned, ...candidate] : candidate;
		if (kept.length > 0 && !fits(tried)) break;
		kept = candidate;
		oldest = index;
	}
	if (latestSave >= 0 && latestSave < oldest && fits([pinned, ...kept])) kept = [pinned, ...kept];
	return kept.flat();
}
