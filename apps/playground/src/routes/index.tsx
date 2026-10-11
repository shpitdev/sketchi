import { useChat } from "@ai-sdk/react";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { DiagramPreview } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";
import { StudioBrand } from "@/components/studio-brand";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
	ArtifactActions,
	AssistantFollowUp,
	BuildResultDetails,
	PlaygroundComposer,
	PlaygroundEmptyState,
	assistantAsksQuestion,
	type ReadyPlaygroundArtifact,
} from "@/features/playground/surface";
import {
	buildResultOf,
	deriveBuildState,
	diagramToolCardStatus,
	isDiagramToolPart,
	type DiagramToolPart,
	type StudioBuildResult,
} from "@/features/playground/build-result";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
	component: StudioRoute,
});

function DiagramToolCard({
	active,
	attempt,
	part,
}: {
	active: boolean;
	attempt: number;
	part: DiagramToolPart;
}) {
	const result = buildResultOf(part);
	const { stopped, title } = diagramToolCardStatus(part, active);

	return (
		<Tool className="studio__tool" defaultOpen={false}>
			<ToolHeader state={part.state} stopped={stopped} title={title} type={part.type} />
			<ToolContent>
				{result ? <BuildResultDetails pass={attempt} result={result} /> : null}
				{part.input === undefined ? null : <ToolInput input={part.input} />}
				{part.state === "output-error" ? (
					<ToolOutput
						errorText="Sketchi couldn’t finish this diagram. Try again, or simplify the request."
						output={undefined}
					/>
				) : null}
			</ToolContent>
		</Tool>
	);
}

function renderAssistantParts(
	message: UIMessage,
	active: boolean,
	onCompose?: () => void,
): ReactNode[] {
	const nodes: ReactNode[] = [];
	let attempt = 0;

	message.parts.forEach((part, index) => {
		if (part.type === "text" && part.text.trim().length > 0) {
			nodes.push(
				<MessageResponse key={`${message.id}-text-${index}`}>{part.text}</MessageResponse>,
			);
			return;
		}

		if (part.type === "reasoning" && part.text.trim().length > 0) {
			nodes.push(
				<Reasoning
					className="studio__reasoning"
					isStreaming={part.state === "streaming"}
					key={`${message.id}-reasoning-${index}`}
				>
					<ReasoningTrigger />
					<ReasoningContent>{part.text}</ReasoningContent>
				</Reasoning>,
			);
			return;
		}

		if (isDiagramToolPart(part)) {
			attempt += 1;
			nodes.push(
				<DiagramToolCard active={active} attempt={attempt} key={part.toolCallId} part={part} />,
			);
		}
	});

	if (onCompose && assistantAsksQuestion(message)) {
		nodes.push(<AssistantFollowUp key={`${message.id}-follow-up`} onCompose={onCompose} />);
	}

	return nodes;
}

function userText(message: UIMessage): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

function StagePlaceholder({
	generating,
	ghostLabels,
}: {
	generating: boolean;
	ghostLabels: string[];
}) {
	return (
		<div className="studio__stage-placeholder">
			<p className="studio__stage-placeholder-text">
				{generating
					? "Drawing your diagram…"
					: "This version needs a few changes. Ask Sketchi to revise it or try another request."}
			</p>
			{ghostLabels.length > 0 ? (
				<div className="studio__ghosts">
					{ghostLabels.map((label) => (
						<span className="studio__ghost" key={label}>
							{label}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function DiagramStage({
	artifact,
	generating,
	ghostLabels,
	result,
	scene,
}: {
	artifact: ReadyPlaygroundArtifact | null;
	generating: boolean;
	ghostLabels: string[];
	result: StudioBuildResult | undefined;
	scene: RenderedDiagramScene | null;
}) {
	const title = scene?.title ?? result?.normalizedSpec?.title ?? "Warming up the pencil";
	return (
		<section className="studio__stage">
			<header className="studio__stage-head">
				<div>
					<h2 className="studio__stage-title">{title}</h2>
				</div>
				<div className="studio__stage-meta">
					{result ? (
						<span
							className={cn(
								"studio__stage-chip",
								result.ok ? "studio__stage-chip--ready" : "studio__stage-chip--draft",
							)}
						>
							{result.ok ? "Ready" : "Needs changes"}
						</span>
					) : null}
				</div>
			</header>
			<div className="studio__stage-card">
				{scene ? (
					<DiagramPreview {...(artifact ? { revision: artifact.artifactId } : {})} scene={scene} />
				) : (
					<StagePlaceholder generating={generating} ghostLabels={ghostLabels} />
				)}
				{generating && scene ? (
					<div className="studio__stage-status">
						<span className="studio__stage-dot" />
						rebuilding…
					</div>
				) : null}
			</div>
			{artifact ? <ArtifactActions artifact={artifact} /> : null}
		</section>
	);
}

function StudioRoute() {
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const [transport] = useState(() => new DefaultChatTransport({ api: "/api/chat" }));
	const { error, messages, sendMessage, status, stop } = useChat({
		transport,
	});
	const busy = status === "submitted" || status === "streaming";

	const { buildMode, displayResult, activePart, scene, artifact, ghostLabels } = useMemo(
		() => deriveBuildState(messages, busy),
		[messages, busy],
	);

	const send = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (trimmed && !busy) {
				void sendMessage({ text: trimmed });
			}
		},
		[busy, sendMessage],
	);

	const handleSubmit = useCallback(
		(message: { text?: string }) => {
			if (busy) {
				void stop();
				return;
			}
			if (message.text) {
				send(message.text);
			}
		},
		[busy, send, stop],
	);

	const focusComposer = useCallback(() => {
		composerRef.current?.focus();
	}, []);

	const isEmpty = messages.length === 0;
	const latestMessage = messages.at(-1);
	const answerableMessageId =
		!busy && latestMessage && assistantAsksQuestion(latestMessage) ? latestMessage.id : undefined;

	return (
		<TooltipProvider delayDuration={300}>
			<main className={cn("studio", buildMode && "studio--build")}>
				<header className="studio__head">
					<StudioBrand />
					<div className="studio__head-actions">
						<a className="studio__artifact-link" href="/projects">
							Projects
						</a>
					</div>
				</header>

				<div className="studio__body">
					{buildMode ? (
						<DiagramStage
							key="stage"
							artifact={artifact}
							generating={Boolean(activePart)}
							ghostLabels={ghostLabels}
							result={displayResult}
							scene={scene}
						/>
					) : null}

					<section className="studio__chat" key="chat">
						{isEmpty ? (
							<PlaygroundEmptyState onSelect={send} />
						) : (
							<Conversation className="studio__conversation">
								<ConversationContent>
									{/* oxlint-disable-next-line react/refs -- focusComposer only runs from the answer chip's click handler */}
									{messages.map((message) => {
										if (message.role === "user") {
											const text = userText(message);
											return text ? (
												<Message from="user" key={message.id}>
													<MessageContent>{text}</MessageContent>
												</Message>
											) : null;
										}

										const parts = renderAssistantParts(
											message,
											// Only the latest assistant message can still be drawing.
											busy && message.id === latestMessage?.id,
											message.id === answerableMessageId ? focusComposer : undefined,
										);
										return parts.length > 0 ? (
											<Message from="assistant" key={message.id}>
												<MessageContent>{parts}</MessageContent>
											</Message>
										) : null;
									})}
									{status === "submitted" ? (
										<Message from="assistant" key="pending">
											<MessageContent>
												<span className="studio__thinking">Sketching…</span>
											</MessageContent>
										</Message>
									) : null}
								</ConversationContent>
								<ConversationScrollButton />
							</Conversation>
						)}

						{error ? (
							<p className="studio__error">Sketchi couldn’t finish that request. Try again.</p>
						) : null}

						<PlaygroundComposer
							buildMode={buildMode}
							composerRef={composerRef}
							onSubmit={handleSubmit}
							status={status}
						/>
					</section>
				</div>
			</main>
		</TooltipProvider>
	);
}
