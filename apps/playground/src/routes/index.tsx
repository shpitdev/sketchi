import { useChat } from "@ai-sdk/react";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { DiagramPreview } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageSquare, PanelsTopLeft, Square } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { StudioHeader } from "@/components/studio-header";
import { TooltipProvider } from "@sketchi/ui/components/tooltip";
import {
	ArtifactActions,
	AssistantFollowUp,
	PlaygroundComposer,
	PlaygroundIntro,
	PlaygroundStarters,
	assistantAsksQuestion,
	type ReadyPlaygroundArtifact,
} from "@/features/playground/surface";
import {
	deriveBuildState,
	isDiagramToolPart,
	type StudioBuildResult,
} from "@/features/playground/build-result";
import { DiagramToolCard } from "@/features/playground/diagram-tool-card";
import { studioChatRequestMessages } from "@/features/playground/studio-chat-request";
import { cn } from "@sketchi/ui/lib/utils";

export const Route = createFileRoute("/")({
	component: StudioRoute,
});

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
					className="w-full"
					defaultOpen={false}
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
	pending,
	generating,
	ghostLabels,
	hasResult,
	onCompose,
}: {
	generating: boolean;
	hasResult: boolean;
	pending: boolean;
	ghostLabels: string[];
	onCompose: () => void;
}) {
	return (
		<div aria-busy={pending} className="studio__stage-placeholder">
			<p className="studio__stage-placeholder-text">
				{generating
					? "Drawing your diagram…"
					: pending
						? "Working on your request…"
						: hasResult
							? "This version needs a few changes. Ask Sketchi to revise it or try another request."
							: null}
			</p>
			{!pending ? <StageReplyButton onCompose={onCompose} /> : null}
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

function StageReplyButton({ onCompose }: { onCompose: () => void }) {
	return (
		<button className="studio__artifact-link" onClick={onCompose} type="button">
			<MessageSquare aria-hidden="true" size={16} /> Reply in conversation
		</button>
	);
}

function DiagramStage({
	pending,
	artifact,
	generating,
	ghostLabels,
	result,
	scene,
	onCompose,
	onStop,
}: {
	artifact: ReadyPlaygroundArtifact | null;
	pending: boolean;
	generating: boolean;
	ghostLabels: string[];
	result: StudioBuildResult | undefined;
	scene: RenderedDiagramScene | null;
	onCompose: () => void;
	onStop: () => void;
}) {
	const title = scene?.title ?? result?.normalizedSpec?.title ?? "";
	return (
		<section aria-label="Diagram" className="studio__stage" id="playground-diagram">
			<header className="studio__stage-head">
				{title ? (
					<h2 className="studio__stage-title" title={title}>
						{title}
					</h2>
				) : null}
				{result && !result.ok ? <span className="studio__stage-chip">Needs changes</span> : null}
				{pending ? (
					<button
						className="studio__artifact-link studio__stage-stop"
						onClick={onStop}
						type="button"
					>
						<Square aria-hidden="true" size={14} /> Stop
					</button>
				) : null}
			</header>
			<div className="studio__stage-card">
				{scene ? (
					<DiagramPreview {...(artifact ? { revision: artifact.artifactId } : {})} scene={scene} />
				) : (
					<StagePlaceholder
						pending={pending}
						generating={generating}
						ghostLabels={ghostLabels}
						hasResult={Boolean(result)}
						onCompose={onCompose}
					/>
				)}
				{generating && scene ? (
					<div className="studio__stage-status">
						<span className="studio__stage-dot" />
						Updating…
					</div>
				) : null}
			</div>
			<div className="studio__stage-footer">
				{artifact ? <ArtifactActions artifact={artifact} /> : null}
			</div>
		</section>
	);
}

function StudioRoute() {
	const [mobilePanel, setMobilePanel] = useState<"chat" | "diagram">("chat");
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const [transport] = useState(
		() =>
			new DefaultChatTransport({
				api: "/api/chat",
				prepareSendMessagesRequest: ({ body, id, messages, messageId, trigger }) => ({
					body: { ...body, id, messages: studioChatRequestMessages(messages), messageId, trigger },
				}),
			}),
	);
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

	const handleStop = useCallback(() => {
		void stop();
	}, [stop]);

	const handleSubmit = useCallback(
		(message: { text?: string }) => {
			if (busy) {
				handleStop();
				return;
			}
			if (message.text) {
				send(message.text);
			}
		},
		[busy, send, handleStop],
	);

	const focusComposer = useCallback(() => {
		setMobilePanel("chat");
		requestAnimationFrame(() => composerRef.current?.focus());
	}, []);

	const isEmpty = messages.length === 0;
	const latestMessage = messages.at(-1);
	const answerableMessageId =
		!busy && latestMessage && assistantAsksQuestion(latestMessage) ? latestMessage.id : undefined;

	return (
		<TooltipProvider delayDuration={300}>
			<main
				className={cn("studio", isEmpty ? "studio--empty" : "studio--build")}
				data-mobile-panel={mobilePanel}
			>
				<StudioHeader>
					<a className="studio-header__link" href="/projects">
						Projects
					</a>
				</StudioHeader>

				{!isEmpty ? (
					<div aria-label="Workspace view" className="studio__view-switch" role="group">
						<button
							aria-controls="playground-conversation"
							aria-pressed={mobilePanel === "chat"}
							onClick={() => setMobilePanel("chat")}
							type="button"
						>
							<MessageSquare aria-hidden="true" size={16} /> Conversation
						</button>
						<button
							aria-controls="playground-diagram"
							aria-pressed={mobilePanel === "diagram"}
							onClick={() => setMobilePanel("diagram")}
							type="button"
						>
							<PanelsTopLeft aria-hidden="true" size={16} /> Diagram
							{scene ? (
								<span className="studio__ready-dot">
									<span className="sr-only">Ready</span>
								</span>
							) : null}
						</button>
					</div>
				) : null}

				<p aria-atomic="true" className={error ? "studio__error" : "sr-only"} role="alert">
					{error ? "Sketchi couldn’t finish that request. Try again." : null}
				</p>

				<div className="studio__body">
					{!isEmpty ? (
						<DiagramStage
							key="stage"
							artifact={artifact}
							generating={Boolean(activePart)}
							pending={busy}
							ghostLabels={ghostLabels}
							result={displayResult}
							scene={scene}
							onCompose={focusComposer}
							onStop={handleStop}
						/>
					) : null}

					<section
						aria-label="Conversation"
						className="studio__chat"
						id="playground-conversation"
						key="chat"
					>
						{/* The composer keeps one position in this list, so sending the first
						    prompt swaps the content around it without remounting the field. */}
						{isEmpty ? (
							<>
								<PlaygroundIntro />
								<PlaygroundStarters onSelect={send} />
							</>
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
								<ConversationScrollButton aria-label="Scroll to latest message" />
							</Conversation>
						)}

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
