import "@tanstack/react-start/server-only";

import {
	makeStudioTimelineToolExecutor,
	STUDIO_BUILD_TIMELINE_TOOL_DESCRIPTION,
	STUDIO_BUILD_TIMELINE_TOOL_NAME,
	StudioBuildTimelineInputSchema,
	StudioBuildTimelineOutputSchema,
} from "./studio-timeline-tool.server";
import {
	makeStudioChartToolExecutor,
	STUDIO_BUILD_CHART_TOOL_DESCRIPTION,
	STUDIO_BUILD_CHART_TOOL_NAME,
	StudioBuildChartInputSchema,
	StudioBuildChartOutputSchema,
} from "./studio-chart-tool.server";

import {
	DIAGRAM_AGENT_TEMPERATURE,
	MAX_AGENT_OUTPUT_TOKENS,
	MAX_AGENT_STEPS,
} from "@sketchi/diagram-agent";
import {
	convertToModelMessages,
	createUIMessageStreamResponse,
	stepCountIs,
	streamText,
	tool,
	validateUIMessages,
} from "ai";
import { Effect, Schema } from "effect";

import {
	MAX_CHAT_MESSAGES,
	MAX_CHAT_TOTAL_CHARACTERS,
	savedLogoSlugs,
} from "../../features/playground/studio-chat-request";
import { readBoundedJson } from "../runtime/request-body.server";
import { PlaygroundAiModel } from "../ai/model.server";
import { logosNamedIn, logosWithSlugs } from "../codemode/icon-catalog.server";
import { PlaygroundCodeMode } from "../codemode/service.server";
import {
	type PlaygroundCallbackEffect,
	PlaygroundRequestCallbacks,
	type PlaygroundRequestRunner,
} from "../runtime/runtime.server";
import {
	makeStudioFlowchartToolExecutor,
	STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
	STUDIO_BUILD_FLOWCHART_TOOL_NAME,
	StudioBuildFlowchartInputSchema,
	StudioBuildFlowchartOutputSchema,
	studioSystemPrompt,
} from "./studio-flowchart-tool.server";
import {
	makeStudioSequenceToolExecutor,
	STUDIO_BUILD_SEQUENCE_TOOL_DESCRIPTION,
	STUDIO_BUILD_SEQUENCE_TOOL_NAME,
	StudioBuildSequenceInputSchema,
	StudioBuildSequenceOutputSchema,
} from "./studio-sequence-tool.server";
import {
	makeStudioBuildTurn,
	studioBuildModelOutput,
	studioTurnOutcome,
} from "./studio-build-tool.server";
import { studioReplyStream, type StudioRun } from "./studio-reply.server";
import {
	makeStudioMindmapToolExecutor,
	STUDIO_BUILD_MINDMAP_TOOL_DESCRIPTION,
	STUDIO_BUILD_MINDMAP_TOOL_NAME,
	StudioBuildMindmapInputSchema,
	StudioBuildMindmapOutputSchema,
} from "./studio-mindmap-tool.server";
import {
	makeStudioStateMachineToolExecutor,
	STUDIO_BUILD_STATE_MACHINE_TOOL_DESCRIPTION,
	STUDIO_BUILD_STATE_MACHINE_TOOL_NAME,
	StudioBuildStateMachineInputSchema,
	StudioBuildStateMachineOutputSchema,
} from "./studio-state-machine-tool.server";
import {
	makeStudioGanttToolExecutor,
	STUDIO_BUILD_GANTT_TOOL_DESCRIPTION,
	STUDIO_BUILD_GANTT_TOOL_NAME,
	StudioBuildGanttInputSchema,
	StudioBuildGanttOutputSchema,
} from "./studio-gantt-tool.server";
import {
	makeStudioErToolExecutor,
	STUDIO_BUILD_ER_TOOL_DESCRIPTION,
	STUDIO_BUILD_ER_TOOL_NAME,
	StudioBuildErInputSchema,
	StudioBuildErOutputSchema,
} from "./studio-er-tool.server";
import {
	makeStudioClassToolExecutor,
	STUDIO_BUILD_CLASS_TOOL_DESCRIPTION,
	STUDIO_BUILD_CLASS_TOOL_NAME,
	StudioBuildClassInputSchema,
	StudioBuildClassOutputSchema,
} from "./studio-class-tool.server";
import {
	makeStudioOrgChartToolExecutor,
	STUDIO_BUILD_ORG_CHART_TOOL_DESCRIPTION,
	STUDIO_BUILD_ORG_CHART_TOOL_NAME,
	StudioBuildOrgChartInputSchema,
	StudioBuildOrgChartOutputSchema,
} from "./studio-org-chart-tool.server";
import {
	makeStudioVennToolExecutor,
	STUDIO_BUILD_VENN_TOOL_DESCRIPTION,
	STUDIO_BUILD_VENN_TOOL_NAME,
	StudioBuildVennInputSchema,
	StudioBuildVennOutputSchema,
} from "./studio-venn-tool.server";
import {
	makeStudioJourneyMapToolExecutor,
	STUDIO_BUILD_JOURNEY_MAP_TOOL_DESCRIPTION,
	STUDIO_BUILD_JOURNEY_MAP_TOOL_NAME,
	StudioBuildJourneyMapInputSchema,
	StudioBuildJourneyMapOutputSchema,
} from "./studio-journey-tool.server";
import {
	makeStudioSankeyToolExecutor,
	STUDIO_BUILD_SANKEY_TOOL_DESCRIPTION,
	STUDIO_BUILD_SANKEY_TOOL_NAME,
	StudioBuildSankeyInputSchema,
	StudioBuildSankeyOutputSchema,
} from "./studio-sankey-tool.server";
import {
	makeStudioWireframeToolExecutor,
	STUDIO_BUILD_WIREFRAME_TOOL_DESCRIPTION,
	STUDIO_BUILD_WIREFRAME_TOOL_NAME,
	StudioBuildWireframeInputSchema,
	StudioBuildWireframeOutputSchema,
} from "./studio-wireframe-tool.server";
import {
	makeStudioQuadrantChartToolExecutor,
	STUDIO_BUILD_QUADRANT_CHART_TOOL_DESCRIPTION,
	STUDIO_BUILD_QUADRANT_CHART_TOOL_NAME,
	StudioBuildQuadrantChartInputSchema,
	StudioBuildQuadrantChartOutputSchema,
} from "./studio-quadrant-chart-tool.server";

export class StudioAgentRequestError extends Schema.TaggedError<StudioAgentRequestError>()(
	"StudioAgentRequestError",
	{
		cause: Schema.Defect(),
		message: Schema.String,
	},
) {}

export const MAX_CHAT_REQUEST_BYTES = 128 * 1024;

const ChatRequestSchema = Schema.Struct({
	messages: Schema.Array(Schema.Unknown),
});

/** Run a Studio build tool's effect inside the chat request's runtime. */
export function makeStudioBuildToolCallback<Input, Result, E>(
	executor: {
		readonly execute: (input: Input) => PlaygroundCallbackEffect<Result, E>;
	},
	runToolEffect: PlaygroundRequestRunner,
) {
	return (input: Input) => runToolEffect(executor.execute(input));
}

/** The text of the user's latest message: what this turn's build is asked to draw. */
function latestUserText(
	messages: ReadonlyArray<{
		readonly role: string;
		readonly parts: ReadonlyArray<{
			readonly type: string;
			readonly text?: unknown;
		}>;
	}>,
): string {
	const latest = messages.findLast((message) => message.role === "user");
	return latest ? userText([latest]) : "";
}

function userText(
	messages: ReadonlyArray<{
		readonly role: string;
		readonly parts: ReadonlyArray<{
			readonly type: string;
			readonly text?: unknown;
		}>;
	}>,
): string {
	return messages
		.filter((message) => message.role === "user")
		.flatMap((message) =>
			message.parts.flatMap((part) =>
				part.type === "text" && typeof part.text === "string" ? [part.text] : [],
			),
		)
		.join("\n");
}

const handleStudioAgentRequestWorkflow = Effect.fn("playground.http.chat")(function* (
	request: Request,
) {
	const bounded = yield* readBoundedJson(request, MAX_CHAT_REQUEST_BYTES);
	if (bounded._tag === "TooLarge") {
		return new Response("Chat request is too large.", { status: 413 });
	}
	if (bounded._tag === "InvalidJson") {
		return new Response("Chat request must be valid JSON.", { status: 400 });
	}
	const body = yield* Schema.decodeUnknownEffect(ChatRequestSchema)(bounded.body).pipe(
		Effect.mapError((cause) =>
			StudioAgentRequestError.make({
				cause,
				message: "No messages provided.",
			}),
		),
	);
	if (body.messages.length === 0) {
		return new Response("No messages provided.", { status: 400 });
	}
	// Include metadata and tool payloads in the character budget, not only text parts.
	if (
		body.messages.length > MAX_CHAT_MESSAGES ||
		JSON.stringify(body.messages).length > MAX_CHAT_TOTAL_CHARACTERS
	) {
		return new Response("Chat messages exceed the conversation limit.", {
			status: 413,
		});
	}
	const messages = yield* Effect.tryPromise({
		try: () => validateUIMessages({ messages: body.messages }),
		catch: (cause) =>
			StudioAgentRequestError.make({
				cause,
				message: "Chat messages are invalid.",
			}),
	});

	const ai = yield* PlaygroundAiModel;
	const callbacks = yield* PlaygroundRequestCallbacks;
	const codeMode = yield* PlaygroundCodeMode;
	const model = yield* ai.model;
	// Logos come only from what the user wrote across the conversation, and the logos its saved
	// diagrams drew, which were grounded in what the user wrote then.
	const named = logosNamedIn(userText(messages));
	const logos = [
		...named,
		...logosWithSlugs(savedLogoSlugs(messages)).filter(
			(logo) => !named.some((known) => known.slug === logo.slug),
		),
	];
	// One budget for the turn: both tools share attempts and the accepted artifact.
	const turn = yield* makeStudioBuildTurn();
	const flowchartExecutor = yield* makeStudioFlowchartToolExecutor(codeMode.buildFlowchart, {
		logos,
		request: latestUserText(messages),
		turn,
	});
	const sequenceExecutor = yield* makeStudioSequenceToolExecutor(codeMode.buildSequenceDiagram, {
		logos,
		turn,
	});

	const mindmapExecutor = yield* makeStudioMindmapToolExecutor(codeMode.buildMindmap, { turn });
	const timelineExecutor = yield* makeStudioTimelineToolExecutor(codeMode.buildTimeline, { turn });
	const chartExecutor = yield* makeStudioChartToolExecutor(codeMode.buildChart, { turn });
	const stateMachineExecutor = yield* makeStudioStateMachineToolExecutor(
		codeMode.buildStateMachine,
		{ turn },
	);
	const ganttExecutor = yield* makeStudioGanttToolExecutor(codeMode.buildGantt, { turn });
	const erExecutor = yield* makeStudioErToolExecutor(codeMode.buildErDiagram, { turn });
	const classExecutor = yield* makeStudioClassToolExecutor(codeMode.buildClassDiagram, { turn });
	const orgChartExecutor = yield* makeStudioOrgChartToolExecutor(codeMode.buildOrgChart, { turn });
	const vennExecutor = yield* makeStudioVennToolExecutor(codeMode.buildVennDiagram, { turn });
	const journeyExecutor = yield* makeStudioJourneyMapToolExecutor(codeMode.buildJourneyMap, {
		turn,
	});
	const sankeyExecutor = yield* makeStudioSankeyToolExecutor(codeMode.buildSankey, { turn });
	const wireframeExecutor = yield* makeStudioWireframeToolExecutor(codeMode.buildWireframe, {
		turn,
	});
	const quadrantChartExecutor = yield* makeStudioQuadrantChartToolExecutor(
		codeMode.buildQuadrantChart,
		{ turn },
	);
	// The model sees each build's compact result, in this turn and in the history it replays; the
	// client keeps the full result with its scene.
	const tools = {
		[STUDIO_BUILD_TIMELINE_TOOL_NAME]: tool({
			description: STUDIO_BUILD_TIMELINE_TOOL_DESCRIPTION,
			inputSchema: StudioBuildTimelineInputSchema,
			outputSchema: StudioBuildTimelineOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(timelineExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_CHART_TOOL_NAME]: tool({
			description: STUDIO_BUILD_CHART_TOOL_DESCRIPTION,
			inputSchema: StudioBuildChartInputSchema,
			outputSchema: StudioBuildChartOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(chartExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_FLOWCHART_TOOL_NAME]: tool({
			description: STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION,
			inputSchema: StudioBuildFlowchartInputSchema,
			outputSchema: StudioBuildFlowchartOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(flowchartExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_MINDMAP_TOOL_NAME]: tool({
			description: STUDIO_BUILD_MINDMAP_TOOL_DESCRIPTION,
			inputSchema: StudioBuildMindmapInputSchema,
			outputSchema: StudioBuildMindmapOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(mindmapExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_STATE_MACHINE_TOOL_NAME]: tool({
			description: STUDIO_BUILD_STATE_MACHINE_TOOL_DESCRIPTION,
			inputSchema: StudioBuildStateMachineInputSchema,
			outputSchema: StudioBuildStateMachineOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(stateMachineExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_GANTT_TOOL_NAME]: tool({
			description: STUDIO_BUILD_GANTT_TOOL_DESCRIPTION,
			inputSchema: StudioBuildGanttInputSchema,
			outputSchema: StudioBuildGanttOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(ganttExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_ER_TOOL_NAME]: tool({
			description: STUDIO_BUILD_ER_TOOL_DESCRIPTION,
			inputSchema: StudioBuildErInputSchema,
			outputSchema: StudioBuildErOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(erExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_CLASS_TOOL_NAME]: tool({
			description: STUDIO_BUILD_CLASS_TOOL_DESCRIPTION,
			inputSchema: StudioBuildClassInputSchema,
			outputSchema: StudioBuildClassOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(classExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_ORG_CHART_TOOL_NAME]: tool({
			description: STUDIO_BUILD_ORG_CHART_TOOL_DESCRIPTION,
			inputSchema: StudioBuildOrgChartInputSchema,
			outputSchema: StudioBuildOrgChartOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(orgChartExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_VENN_TOOL_NAME]: tool({
			description: STUDIO_BUILD_VENN_TOOL_DESCRIPTION,
			inputSchema: StudioBuildVennInputSchema,
			outputSchema: StudioBuildVennOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(vennExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_JOURNEY_MAP_TOOL_NAME]: tool({
			description: STUDIO_BUILD_JOURNEY_MAP_TOOL_DESCRIPTION,
			inputSchema: StudioBuildJourneyMapInputSchema,
			outputSchema: StudioBuildJourneyMapOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(journeyExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_SANKEY_TOOL_NAME]: tool({
			description: STUDIO_BUILD_SANKEY_TOOL_DESCRIPTION,
			inputSchema: StudioBuildSankeyInputSchema,
			outputSchema: StudioBuildSankeyOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(sankeyExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_WIREFRAME_TOOL_NAME]: tool({
			description: STUDIO_BUILD_WIREFRAME_TOOL_DESCRIPTION,
			inputSchema: StudioBuildWireframeInputSchema,
			outputSchema: StudioBuildWireframeOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(wireframeExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_QUADRANT_CHART_TOOL_NAME]: tool({
			description: STUDIO_BUILD_QUADRANT_CHART_TOOL_DESCRIPTION,
			inputSchema: StudioBuildQuadrantChartInputSchema,
			outputSchema: StudioBuildQuadrantChartOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(quadrantChartExecutor, callbacks.runPromise),
		}),
		[STUDIO_BUILD_SEQUENCE_TOOL_NAME]: tool({
			description: STUDIO_BUILD_SEQUENCE_TOOL_DESCRIPTION,
			inputSchema: StudioBuildSequenceInputSchema,
			outputSchema: StudioBuildSequenceOutputSchema,
			toModelOutput: studioBuildModelOutput,
			execute: makeStudioBuildToolCallback(sequenceExecutor, callbacks.runPromise),
		}),
	};
	const modelMessages = yield* Effect.tryPromise({
		try: () => convertToModelMessages(messages, { tools }),
		catch: (cause) =>
			StudioAgentRequestError.make({
				cause,
				message: cause instanceof Error ? cause.message : "Chat request failed.",
			}),
	});
	return yield* Effect.try({
		try: () => {
			const run = ({ messages, abortSignal }: StudioRun) =>
				streamText({
					abortSignal,
					model,
					system: studioSystemPrompt(logos),
					messages: [...messages],
					tools,
					stopWhen: stepCountIs(MAX_AGENT_STEPS),
					maxOutputTokens: MAX_AGENT_OUTPUT_TOKENS,
					temperature: DIAGRAM_AGENT_TEMPERATURE,
				});

			return createUIMessageStreamResponse({
				stream: studioReplyStream({
					messages: modelMessages,
					run,
					outcome: () => callbacks.runPromise(studioTurnOutcome(turn)),
					abortSignal: request.signal,
					onError: (error) => (error instanceof Error ? error.message : "The agent run failed."),
				}),
			});
		},
		catch: (cause) =>
			StudioAgentRequestError.make({
				cause,
				message: cause instanceof Error ? cause.message : "Chat request failed.",
			}),
	});
});

export const handleStudioAgentRequest = Effect.fn("playground.http.chat.response")(
	(request: Request) =>
		handleStudioAgentRequestWorkflow(request).pipe(
			Effect.catchTags({
				StudioAgentRequestError: (error) =>
					Effect.succeed(new Response(error.message, { status: 400 })),
				StudioAiModelError: () =>
					Effect.succeed(new Response("Chat is temporarily unavailable.", { status: 503 })),
			}),
		),
);
