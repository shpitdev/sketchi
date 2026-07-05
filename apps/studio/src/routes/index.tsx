import { useChat } from "@ai-sdk/react";
import {
  normalizeDiagramInput,
  type DiagramGradeReport,
  type DiagramToolInput,
} from "@sketchi/diagram-agent";
import {
  renderIntermediateDiagram,
  type RenderedDiagramScene,
} from "@sketchi/diagram-renderer";
import { DiagramPreview } from "@sketchi/diagram-studio-ui";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Suggestion } from "@/components/ai-elements/suggestion";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: StudioRoute,
});

const STARTERS = [
  "Sketch a login flow with retries and a fraud check",
  "Diagram a CI/CD pipeline from commit to production",
  "Map the data flow for an AI chat app with streaming",
];

type MessagePart = UIMessage["parts"][number];

interface DiagramToolPart {
  type: "tool-create_diagram";
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

interface PlaygroundArtifactResponse {
  ok: boolean;
  artifact?: {
    artifactId?: string;
  };
  exportUrls?: {
    excalidraw?: string;
    scene?: string;
  };
  editUrl?: string;
  issues?: Array<{
    message?: string;
  }>;
  viewUrl?: string;
}

interface ReadyPlaygroundArtifact {
  artifactId: string;
  exportUrls: {
    excalidraw: string;
    scene: string;
  };
  editUrl: string;
  viewUrl: string;
}

type PlaygroundArtifactState =
  | { status: "idle" }
  | { key: string; status: "saving" }
  | {
      artifact: ReadyPlaygroundArtifact;
      key: string;
      status: "ready";
    }
  | { key: string; message: string; status: "error" };

function isDiagramToolPart(
  part: MessagePart,
): part is DiagramToolPart & MessagePart {
  return part.type === "tool-create_diagram";
}

function gradeReportOf(part: DiagramToolPart): DiagramGradeReport | undefined {
  if (part.state !== "output-available") {
    return undefined;
  }
  const output = part.output as Partial<DiagramGradeReport> | undefined;
  return output && typeof output.grade === "number"
    ? (output as DiagramGradeReport)
    : undefined;
}

function isArtifactResponse(
  value: unknown,
): value is PlaygroundArtifactResponse {
  return Boolean(value) && typeof value === "object";
}

function artifactErrorMessage(value: unknown, fallback: string): string {
  if (!isArtifactResponse(value)) {
    return fallback;
  }

  const issue = value.issues?.find(
    (candidate) =>
      typeof candidate.message === "string" &&
      candidate.message.trim().length > 0,
  );
  return issue?.message ?? fallback;
}

function artifactFromResponse(
  value: PlaygroundArtifactResponse,
): ReadyPlaygroundArtifact | null {
  const artifactId = value.artifact?.artifactId;
  const scene = value.exportUrls?.scene;
  const excalidraw = value.exportUrls?.excalidraw;
  const editUrl = value.editUrl;
  const viewUrl = value.viewUrl;

  if (!artifactId || !scene || !excalidraw || !editUrl || !viewUrl) {
    return null;
  }

  return {
    artifactId,
    exportUrls: {
      excalidraw,
      scene,
    },
    editUrl,
    viewUrl,
  };
}

function GradeReport({ report }: { report: DiagramGradeReport }) {
  return (
    <div className="studio__grade">
      <div className="studio__grade-row">
        <span
          className={cn(
            "studio__grade-score",
            report.accepted ? "is-accepted" : "is-rejected",
          )}
        >
          {report.grade.toFixed(1)} / 10
        </span>
        <span className="studio__grade-summary">{report.summary}</span>
        <span
          className={cn(
            "studio__stage-chip",
            report.accepted
              ? "studio__stage-chip--grade"
              : "studio__stage-chip--draft",
          )}
        >
          {report.accepted ? "accepted" : "revise"}
        </span>
      </div>
      {report.issues.length > 0 ? (
        <ul className="studio__grade-issues">
          {report.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ArtifactActions({ state }: { state: PlaygroundArtifactState }) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "saving") {
    return (
      <div className="studio__artifact-actions">
        <span className="studio__artifact-status">saving artifact...</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="studio__artifact-actions">
        <span className="studio__artifact-status studio__artifact-status--error">
          {state.message}
        </span>
      </div>
    );
  }

  return (
    <div className="studio__artifact-actions">
      <a className="studio__artifact-link" href={state.artifact.viewUrl}>
        Open artifact
      </a>
      <a className="studio__artifact-link" href={state.artifact.editUrl}>
        Edit
      </a>
      <a
        className="studio__artifact-link"
        href={state.artifact.exportUrls.scene}
      >
        Scene file
      </a>
      <a
        className="studio__artifact-link"
        href={state.artifact.exportUrls.excalidraw}
      >
        Drawing file
      </a>
    </div>
  );
}

function DiagramToolCard({
  attempt,
  part,
}: {
  attempt: number;
  part: DiagramToolPart;
}) {
  const report = gradeReportOf(part);
  const title =
    part.state === "input-streaming"
      ? `sketching diagram · attempt ${attempt}`
      : part.state === "input-available"
        ? `grading sketch · attempt ${attempt}`
        : part.state === "output-error"
          ? `sketch failed · attempt ${attempt}`
          : report?.accepted
            ? `sketch accepted · attempt ${attempt}`
            : `needs another pass · attempt ${attempt}`;

  return (
    <Tool className="studio__tool" defaultOpen={false}>
      <ToolHeader state={part.state} title={title} type="tool-create_diagram" />
      <ToolContent>
        {part.input === undefined ? null : <ToolInput input={part.input} />}
        {report ? <GradeReport report={report} /> : null}
        {part.state === "output-error" ? (
          <ToolOutput errorText={part.errorText} output={undefined} />
        ) : null}
      </ToolContent>
    </Tool>
  );
}

function renderAssistantParts(message: UIMessage): ReactNode[] {
  const nodes: ReactNode[] = [];
  let attempt = 0;

  message.parts.forEach((part, index) => {
    if (part.type === "text" && part.text.trim().length > 0) {
      nodes.push(
        <MessageResponse key={`${message.id}-text-${index}`}>
          {part.text}
        </MessageResponse>,
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
        <DiagramToolCard attempt={attempt} key={part.toolCallId} part={part} />,
      );
    }
  });

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
          ? "sketching the first draft…"
          : "nothing on the canvas yet — ask for another pass"}
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
  artifactState,
  attemptCount,
  generating,
  ghostLabels,
  report,
  scene,
}: {
  artifactState: PlaygroundArtifactState;
  attemptCount: number;
  generating: boolean;
  ghostLabels: string[];
  report: DiagramGradeReport | undefined;
  scene: RenderedDiagramScene | null;
}) {
  return (
    <section className="studio__stage">
      <header className="studio__stage-head">
        <div>
          <p className="studio__stage-kicker">canvas</p>
          <h2 className="studio__stage-title">
            {scene?.title ?? "Warming up the pencil"}
          </h2>
        </div>
        <div className="studio__stage-meta">
          {report ? (
            <span className="studio__stage-chip studio__stage-chip--grade">
              grade {report.grade.toFixed(1)}
            </span>
          ) : null}
          {attemptCount > 1 ? (
            <span className="studio__stage-chip">sketch {attemptCount}</span>
          ) : null}
          {report && !report.accepted ? (
            <span className="studio__stage-chip studio__stage-chip--draft">
              draft
            </span>
          ) : null}
        </div>
      </header>
      <div className="studio__stage-card">
        {scene ? (
          <DiagramPreview scene={scene} />
        ) : (
          <StagePlaceholder generating={generating} ghostLabels={ghostLabels} />
        )}
        {generating && scene ? (
          <div className="studio__stage-status">
            <span className="studio__stage-dot" />
            redrawing…
          </div>
        ) : null}
      </div>
      {report?.accepted ? <ArtifactActions state={artifactState} /> : null}
    </section>
  );
}

function StudioRoute() {
  const [transport] = useState(
    () => new DefaultChatTransport({ api: "/api/chat" }),
  );
  const { error, messages, sendMessage, status, stop } = useChat({
    transport,
  });
  const [artifactState, setArtifactState] = useState<PlaygroundArtifactState>({
    status: "idle",
  });
  const artifactKeyRef = useRef<string | null>(null);

  const busy = status === "submitted" || status === "streaming";

  const toolParts = useMemo(
    () =>
      messages.flatMap((message) => message.parts.filter(isDiagramToolPart)),
    [messages],
  );
  const buildMode = toolParts.length > 0;

  const gradedParts = useMemo(
    () => toolParts.filter((part) => gradeReportOf(part) !== undefined),
    [toolParts],
  );
  const displayPart = useMemo(() => {
    const reversed = [...gradedParts].reverse();
    return (
      reversed.find((part) => gradeReportOf(part)?.accepted) ?? reversed[0]
    );
  }, [gradedParts]);
  const activePart = toolParts.find(
    (part) =>
      part.state === "input-streaming" || part.state === "input-available",
  );

  const displayReport = displayPart ? gradeReportOf(displayPart) : undefined;

  const scene = useMemo(() => {
    if (!displayPart?.input) {
      return null;
    }
    try {
      return renderIntermediateDiagram(
        normalizeDiagramInput(displayPart.input as DiagramToolInput),
      );
    } catch {
      return null;
    }
  }, [displayPart]);

  const artifactKey =
    displayPart && displayReport?.accepted ? displayPart.toolCallId : undefined;
  const artifactInput = artifactKey ? displayPart?.input : undefined;
  const artifactPayload = useMemo(() => {
    if (!artifactKey || artifactInput === undefined) {
      return undefined;
    }

    try {
      return JSON.stringify({ input: artifactInput });
    } catch {
      return undefined;
    }
  }, [artifactInput, artifactKey]);

  useEffect(() => {
    if (!artifactKey || !artifactPayload) {
      artifactKeyRef.current = null;
      setArtifactState({ status: "idle" });
      return;
    }

    if (artifactKeyRef.current === artifactKey) {
      return;
    }

    artifactKeyRef.current = artifactKey;
    let cancelled = false;
    setArtifactState({ key: artifactKey, status: "saving" });

    void (async () => {
      let payload: unknown;
      try {
        const response = await fetch("/api/playground/artifacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: artifactPayload,
        });
        payload = await response.json();

        if (!response.ok || !isArtifactResponse(payload) || !payload.ok) {
          throw new Error(
            artifactErrorMessage(payload, "Artifact could not be saved."),
          );
        }

        const artifact = artifactFromResponse(payload);
        if (!artifact) {
          throw new Error("Artifact response was incomplete.");
        }

        if (!cancelled) {
          setArtifactState({
            artifact,
            key: artifactKey,
            status: "ready",
          });
        }
      } catch (caught) {
        if (!cancelled) {
          setArtifactState({
            key: artifactKey,
            message:
              caught instanceof Error
                ? caught.message
                : "Artifact could not be saved.",
            status: "error",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifactKey, artifactPayload]);

  const ghostLabels = useMemo(() => {
    const input = activePart?.input as
      | { nodes?: { label?: unknown }[] }
      | undefined;
    if (!input?.nodes) {
      return [];
    }
    return input.nodes
      .map((node) =>
        node && typeof node.label === "string" ? node.label.trim() : "",
      )
      .filter((label) => label.length > 0)
      .slice(0, 24);
  }, [activePart]);

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

  const isEmpty = messages.length === 0;

  return (
    <TooltipProvider delayDuration={300}>
      <main className={cn("studio", buildMode && "studio--build")}>
        <header className="studio__head">
          <span className="studio__mark">sketchi</span>
          <span className="studio__sub">playground · ephemeral</span>
        </header>

        <div className="studio__body">
          <section className="studio__chat">
            {isEmpty ? (
              <div className="studio__empty-wrap">
                <div className="studio__empty">
                  <p className="studio__empty-title">What should we draw?</p>
                  <p className="studio__empty-sub">
                    Describe a system or flow. Sketchi clarifies what matters,
                    then sketches it onto the canvas — grading its own work
                    until it holds up.
                  </p>
                  <div className="studio__starters">
                    {STARTERS.map((starter) => (
                      <Suggestion
                        key={starter}
                        onClick={(value) => send(value)}
                        suggestion={starter}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Conversation className="studio__conversation">
                <ConversationContent>
                  {messages.map((message) => {
                    if (message.role === "user") {
                      const text = userText(message);
                      return text ? (
                        <Message from="user" key={message.id}>
                          <MessageContent>{text}</MessageContent>
                        </Message>
                      ) : null;
                    }

                    const parts = renderAssistantParts(message);
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

            {error ? <p className="studio__error">{error.message}</p> : null}

            <div className="studio__composer">
              <PromptInput onSubmit={handleSubmit}>
                <PromptInputBody>
                  <PromptInputTextarea
                    placeholder={
                      buildMode
                        ? "Ask for changes to the sketch…"
                        : "Describe a diagram…"
                    }
                  />
                </PromptInputBody>
                <PromptInputFooter>
                  <span className="studio__composer-hint">
                    Enter to send · Shift+Enter for a new line
                  </span>
                  <PromptInputSubmit status={status} />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </section>

          {buildMode ? (
            <DiagramStage
              artifactState={artifactState}
              attemptCount={toolParts.length}
              generating={Boolean(activePart)}
              ghostLabels={ghostLabels}
              report={displayReport}
              scene={scene}
            />
          ) : null}
        </div>
      </main>
    </TooltipProvider>
  );
}
