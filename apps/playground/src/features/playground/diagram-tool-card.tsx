import { useState } from "react";

import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";
import { buildResultOf, diagramToolCardStatus, type DiagramToolPart } from "./build-result";
import { BuildResultDetails } from "./surface";

/** Lines the live block keeps; it shows only the newest few, so this bounds each render. */
const LIVE_TAIL_LINES = 40;
/** Roughly the lines the live block fits; beyond this its top edge fades. */
const LIVE_VISIBLE_LINES = 10;

/** The newest lines of a call's pretty-printed input, as it is being written. */
export function liveInputTail(input: unknown): {
	readonly clipped: boolean;
	readonly text: string;
} {
	const lines = (JSON.stringify(input, null, 2) ?? "").split("\n");
	return {
		clipped: lines.length > LIVE_VISIBLE_LINES,
		text: lines.slice(-LIVE_TAIL_LINES).join("\n"),
	};
}

function LiveToolInput({ input, streaming }: { input: unknown; streaming: boolean }) {
	const { clipped, text } = liveInputTail(input);
	return (
		<pre className="studio__live-input" data-clipped={clipped || undefined}>
			<code>
				{text}
				{streaming ? <span aria-hidden="true" className="studio__live-caret" /> : null}
			</code>
		</pre>
	);
}

/**
 * One build call in the chat. While the call is written and checked the card
 * stays open on the newest lines of its input; once it finishes it collapses
 * to its result line, and opening it shows the result and the full input. A
 * reader's own open or close wins over both.
 */
export function DiagramToolCard({
	active,
	attempt,
	part,
}: {
	active: boolean;
	attempt: number;
	part: DiagramToolPart;
}) {
	const result = buildResultOf(part);
	const { stopped, title, writing } = diagramToolCardStatus(part, active);
	const [chosenOpen, setChosenOpen] = useState<boolean>();
	const live = writing && part.input !== undefined;

	return (
		<Tool className="bg-card" onOpenChange={setChosenOpen} open={chosenOpen ?? live}>
			<ToolHeader state={part.state} stopped={stopped} title={title} type={part.type} />
			{/* Collapsing on its own, the card closes at once rather than flashing
			    the finished details on the way out. */}
			<ToolContent data-auto-collapse={chosenOpen === undefined || undefined}>
				{writing ? (
					live ? (
						<LiveToolInput input={part.input} streaming={part.state === "input-streaming"} />
					) : null
				) : (
					<>
						{result ? <BuildResultDetails pass={attempt} result={result} /> : null}
						{part.input === undefined ? null : <ToolInput input={part.input} />}
						{part.state === "output-error" ? (
							<ToolOutput
								errorText="Sketchi couldn’t finish this diagram. Try again, or simplify the request."
								output={undefined}
							/>
						) : null}
					</>
				)}
			</ToolContent>
		</Tool>
	);
}
