import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
	buildLogoSlugs,
	compactBuildOutput,
	MAX_CHAT_MESSAGES,
	MAX_CHAT_TOTAL_CHARACTERS,
	savedLogoSlugs,
	studioChatRequestMessages,
} from "./studio-chat-request";

const scene = { elements: "x".repeat(16_000), files: { logo: "y".repeat(2_000) } };

function accepted(id: string) {
	return {
		ok: true,
		status: "accepted",
		buildId: `build_${id}`,
		normalizedSpec: { title: id, nodes: { a: "A" } },
		quality: {
			accepted: true,
			score: 9,
			threshold: 8,
			checks: [
				{ code: "labels", passed: true, message: "Labels fit." },
				{ code: "crossings", passed: false, message: "Two edges cross.", refs: [] },
			],
		},
		artifact: {
			artifactId: `artifact_${id}`,
			formats: [
				{ format: "scene", inline: scene },
				{ format: "excalidraw", url: "/x" },
			],
		},
		issues: [],
	};
}

function user(id: string, text = `Request ${id}.`): UIMessage {
	return { id: `u${id}`, role: "user", parts: [{ type: "text", text }] };
}

function builds(id: string, output: unknown = accepted(id)): UIMessage {
	return {
		id: `a${id}`,
		role: "assistant",
		parts: [
			{
				type: "tool-build_mindmap",
				toolCallId: `call_${id}`,
				state: "output-available",
				input: { spec: { title: `Garden ${id}`, root: "Garden" } },
				output,
			},
			{ type: "text", text: "Here it is." },
		],
	};
}

function says(id: string, text: string): UIMessage {
	return { id: `a${id}`, role: "assistant", parts: [{ type: "text", text }] };
}

describe("Studio chat request", () => {
	it("sends an earlier build as its compact result, without the scene", () => {
		expect(compactBuildOutput(accepted("1"))).toEqual({
			ok: true,
			status: "accepted",
			buildId: "build_1",
			artifact: { artifactId: "artifact_1" },
			issues: [],
			quality: {
				accepted: true,
				score: 9,
				threshold: 8,
				checks: [{ code: "crossings", passed: false, message: "Two edges cross.", refs: [] }],
			},
		});
		const sent = JSON.stringify(studioChatRequestMessages([user("1"), builds("1"), user("2")]));
		expect(sent).not.toContain("xxxx");
		expect(sent).not.toContain("normalizedSpec");
		expect(sent).toContain('"title":"Garden 1"');
	});

	it("sends a mindmap and two edits under the limit the full scenes went past", () => {
		const messages = [
			user("1"),
			builds("1"),
			user("2"),
			builds("2"),
			user("3"),
			builds("3"),
			user("4"),
		];
		expect(JSON.stringify(messages).length).toBeGreaterThan(MAX_CHAT_TOTAL_CHARACTERS);
		expect(studioChatRequestMessages(messages)).toHaveLength(messages.length);
		expect(JSON.stringify(studioChatRequestMessages(messages)).length).toBeLessThan(
			MAX_CHAT_TOTAL_CHARACTERS,
		);
	});

	it("keeps the latest exchanges of a long conversation within the limits", () => {
		const long = "z".repeat(1_500);
		const messages: UIMessage[] = [];
		for (let edit = 0; edit < 40; edit += 1) {
			messages.push(user(String(edit), `Edit ${edit}. ${long}`), builds(String(edit)));
		}
		messages.push(user("last"));
		const sent = studioChatRequestMessages(messages);
		expect(sent.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGES);
		expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MAX_CHAT_TOTAL_CHARACTERS);
		expect(sent.at(-1)?.id).toBe("ulast");
		expect(sent.at(-2)?.id).toBe("a39");
		expect(sent[0]?.role).toBe("user");
		expect(sent.map((message) => message.id)).not.toContain("u0");
	});

	it("keeps the latest diagram's build when newer talk fills the request", () => {
		const chatter = "w".repeat(4_000);
		const messages: UIMessage[] = [user("0"), builds("0"), user("1"), builds("1")];
		for (let turn = 2; turn < 12; turn += 1) {
			messages.push(user(String(turn), `Question ${turn}?`), says(String(turn), chatter));
		}
		messages.push(user("last"));
		const sent = studioChatRequestMessages(messages);
		const ids = sent.map((message) => message.id);
		expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MAX_CHAT_TOTAL_CHARACTERS);
		expect(ids[0]).toBe("a1");
		expect(sent[0]?.parts.map((part) => part.type)).toEqual(["tool-build_mindmap"]);
		expect(ids).not.toContain("u1");
		expect(ids).not.toContain("a0");
		expect(ids.at(-1)).toBe("ulast");
	});

	it("budgets the saved diagram together with a large new request", () => {
		const saved = [user("0", "s".repeat(17_000)), builds("0")];
		const sent = studioChatRequestMessages([...saved, user("1", "n".repeat(16_000))]);
		expect(JSON.stringify([...saved, user("1", "n".repeat(16_000))]).length).toBeGreaterThan(
			MAX_CHAT_TOTAL_CHARACTERS,
		);
		expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MAX_CHAT_TOTAL_CHARACTERS);
		expect(sent.map((message) => message.id)).toEqual(["a0", "u1"]);
		expect(JSON.stringify(sent)).toContain('"title":"Garden 0"');
	});

	it("carries the logos a saved diagram drew in its compact result", () => {
		const flowchart = {
			...accepted("1"),
			normalizedSpec: {
				logos: true,
				nodes: { pay: { label: "Stripe", icon: "stripe" }, db: { label: "Orders", icon: null } },
			},
		};
		const sequence = {
			...accepted("2"),
			normalizedSpec: {
				participants: [{ id: "db", label: "Postgres", icon: { slug: "postgresql" } }],
			},
		};
		expect(buildLogoSlugs(flowchart)).toEqual(["stripe"]);
		expect(compactBuildOutput(flowchart)).toMatchObject({ logos: ["stripe"] });
		expect(buildLogoSlugs(compactBuildOutput(sequence))).toEqual(["postgresql"]);
		expect(buildLogoSlugs({ ...flowchart, ok: false })).toEqual([]);
		expect(
			savedLogoSlugs(studioChatRequestMessages([user("1"), builds("1", flowchart), user("2")])),
		).toEqual(["stripe"]);
	});

	it("still sends the latest exchange when it is too large on its own", () => {
		const sent = studioChatRequestMessages([
			user("0"),
			builds("0"),
			user("1", "q".repeat(MAX_CHAT_TOTAL_CHARACTERS + 10)),
		]);
		expect(sent.at(-1)?.id).toBe("u1");
	});
});
