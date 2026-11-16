import { DIAGRAM_TYPES } from "@sketchi/diagrams/family";
import { Clock, Effect, Option } from "effect";
import stringWidth from "string-width";

import type { DiagramListEntry } from "../contracts.js";
import { entryTime, matchesQuery, newestFirst, relativeTime } from "../diagram-catalog.js";
import { DiagramStore } from "../store/service.js";
import { Argument, Command, Flag } from "../terminal/effect-cli.js";
import { runReported } from "../terminal/output.js";
import { rootCommand } from "./root.js";

const DEFAULT_LIST_LIMIT = 20;
const LIST_TITLE_WIDTH = 48;

function fitWidth(value: string, width: number): string {
	if (stringWidth(value) <= width) return value;
	let fitted = "";
	for (const character of value) {
		if (stringWidth(`${fitted}${character}…`) > width) break;
		fitted += character;
	}
	return `${fitted}…`;
}

function padWidth(value: string, width: number): string {
	return `${value}${" ".repeat(Math.max(0, width - stringWidth(value)))}`;
}

interface ListResult {
	readonly entries: ReadonlyArray<DiagramListEntry>;
	readonly total: number;
	readonly searched: boolean;
	readonly now: number;
}

function listText({ entries, total, searched, now }: ListResult): string {
	if (entries.length === 0) {
		return searched
			? "No matching diagrams."
			: "No diagrams yet. Create one with sketchi generate.";
	}
	const rows = entries.map((entry) => {
		if ("status" in entry) return [entry.id, `unavailable: ${entry.code}`, "", ""];
		const time = entryTime(entry);
		return [
			entry.id,
			fitWidth(entry.title, LIST_TITLE_WIDTH),
			entry.type,
			time === undefined ? "" : relativeTime(time, now),
		];
	});
	const widths = [0, 1, 2].map((column) =>
		Math.max(...rows.map((cells) => stringWidth(cells[column] ?? ""))),
	);
	const lines = rows.map((cells) =>
		cells
			.map((cell, column) => (column < 3 ? padWidth(cell, (widths[column] ?? 0) + 2) : cell))
			.join("")
			.trimEnd(),
	);
	const hidden = total - entries.length;
	return [
		...lines,
		...(hidden > 0
			? [`${String(hidden)} older not shown; --limit ${String(total)} shows all`]
			: []),
	].join("\n");
}

export const listCommand = Command.make(
	"list",
	{
		text: Argument.String("text").pipe(
			Argument.withDescription("Words to find in titles, ids, and prompts."),
			Argument.variadic(),
		),
		type: Flag.optional(
			Flag.Literals("type", ["canvas", ...DIAGRAM_TYPES]).pipe(
				Flag.withDescription("Only diagrams of this type."),
				Flag.withMetavar("TYPE"),
			),
		),
		limit: Flag.optional(
			Flag.Int("limit").pipe(
				Flag.filter(
					(limit) => limit > 0,
					(limit) => `Expected a positive limit, got ${String(limit)}`,
				),
				Flag.withDescription(
					`Most diagrams to show; text output defaults to ${String(DEFAULT_LIST_LIMIT)}.`,
				),
				Flag.withMetavar("N"),
			),
		),
	},
	({ limit, text, type }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const store = yield* DiagramStore;
			const now = yield* Clock.currentTimeMillis;
			const query = {
				text: text.join(" "),
				...Option.match(type, { onNone: () => ({}), onSome: (value) => ({ type: value }) }),
			};
			// JSON lists every match unless --limit is explicit; text keeps a screenful.
			const shown = Option.getOrElse(limit, () =>
				output === "json" ? Number.POSITIVE_INFINITY : DEFAULT_LIST_LIMIT,
			);
			const operation = store.list().pipe(
				Effect.map((all) => {
					const matched = newestFirst(all).filter((entry) => matchesQuery(entry, query));
					return {
						entries: matched.slice(0, shown),
						total: matched.length,
						searched: query.text !== "" || query.type !== undefined,
						now,
					} satisfies ListResult;
				}),
			);
			yield* runReported("list", output, operation, listText, (result) => result.entries);
		}),
).pipe(
	Command.withDescription(
		`List local diagrams newest first with id, title, type, and when each was created; records from before creation times were stored use their last change. Words narrow the list to diagrams whose title, id, or generate prompt contains every word. Text output shows ${String(DEFAULT_LIST_LIMIT)} and says how many older ones it hid. --output json returns every match as an array in the same newest-first order, with createdAt, updatedAt, and prompt when known. Strictly offline and read-only.`,
	),
	Command.withShortDescription("Find local diagrams, newest first."),
	Command.withExamples([
		{ command: "sketchi list", description: "Show the most recent diagrams." },
		{ command: "sketchi list checkout", description: "Find diagrams about checkout." },
		{
			command: "sketchi list --type sequence --limit 5 --output json",
			description: "The five newest sequence diagrams as JSON.",
		},
	]),
);
