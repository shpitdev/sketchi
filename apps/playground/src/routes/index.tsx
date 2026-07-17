import { useChat } from "@ai-sdk/react";
import {
  BuildFlowchartRequestSchema,
  CodeModeIssueSchema,
  RenderedDiagramSceneSchema,
  type BuildFlowchartResult,
} from "@sketchi/diagram-agent";
import type { RenderedDiagramScene } from "@sketchi/diagram-renderer";
import { DiagramPreview, FlowchartBuildReport } from "@sketchi/diagram-ui";
import { createFileRoute } from "@tanstack/react-router";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useMemo, useState, type ReactNode } from "react";

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
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { SKETCHI_WEB_HOME_URL } from "@/lib/home-url";
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

interface FlowchartToolPart {
  type: "tool-build_flowchart";
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

interface ReadyPlaygroundArtifact {
  artifactId: string;
  exportUrls: {
    excalidraw: string;
    scene: string;
  };
  editUrl: string;
  viewUrl: string;
}

function isFlowchartToolPart(
  part: MessagePart,
): part is FlowchartToolPart & MessagePart {
  return part.type === "tool-build_flowchart";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBuildFlowchartFailureStatus(
  value: unknown,
): value is Exclude<BuildFlowchartResult, { ok: true }>["status"] {
  switch (value) {
    case "invalid_input":
    case "invalid_flowchart":
    case "quality_failed":
    case "render_failed":
    case "export_failed":
    case "storage_failed":
      return true;
    default:
      return false;
  }
}

function isBuildFlowchartResult(value: unknown): value is BuildFlowchartResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.issues) ||
    !value.issues.every((issue) => CodeModeIssueSchema.safeParse(issue).success)
  ) {
    return false;
  }

  if (value.ok === true) {
    return (
      value.status === "accepted" &&
      typeof value.buildId === "string" &&
      isRecord(value.normalizedSpec) &&
      isRecord(value.quality) &&
      isRecord(value.artifact)
    );
  }

  return value.ok === false && isBuildFlowchartFailureStatus(value.status);
}

function buildResultOf(
  part: FlowchartToolPart,
): BuildFlowchartResult | undefined {
  if (part.state !== "output-available") {
    return undefined;
  }
  return isBuildFlowchartResult(part.output) ? part.output : undefined;
}

function artifactFromResponse(
  result: BuildFlowchartResult,
): ReadyPlaygroundArtifact | null {
  if (!result.ok) {
    return null;
  }
  const artifactId = result.artifact.artifactId;
  const formats = new Set(
    result.artifact.formats.map((format) => format.format),
  );
  if (!formats.has("scene") || !formats.has("excalidraw")) {
    return null;
  }
  const encoded = encodeURIComponent(artifactId);

  return {
    artifactId,
    exportUrls: {
      excalidraw: `/api/v1/artifacts/${encoded}?format=excalidraw&raw=true`,
      scene: `/api/v1/artifacts/${encoded}?format=scene&raw=true`,
    },
    editUrl: `/artifacts/${encoded}/edit`,
    viewUrl: `/artifacts/${encoded}`,
  };
}

function isRenderedDiagramScene(value: unknown): value is RenderedDiagramScene {
  return RenderedDiagramSceneSchema.safeParse(value).success;
}

function sceneFromResult(
  result: BuildFlowchartResult | undefined,
): RenderedDiagramScene | null {
  if (!result?.ok) {
    return null;
  }
  const scene = result.artifact.formats.find(
    (format) => format.format === "scene",
  )?.inline;
  return isRenderedDiagramScene(scene) ? scene : null;
}

function ArtifactActions({ artifact }: { artifact: ReadyPlaygroundArtifact }) {
  return (
    <div className="studio__artifact-actions">
      <IconActionBar>
        <IconLink href={artifact.viewUrl} icon="open" label="Open artifact" />
        <IconLink href={artifact.editUrl} icon="edit" label="Edit" />
        <IconLink
          href={artifact.exportUrls.scene}
          icon="scene"
          label="Scene file"
        />
        <IconLink
          href={artifact.exportUrls.excalidraw}
          icon="drawing"
          label="Drawing file"
        />
      </IconActionBar>
      <p className="studio__note">Shareable by link · no account yet</p>
    </div>
  );
}

function FlowchartToolCard({
  attempt,
  part,
}: {
  attempt: number;
  part: FlowchartToolPart;
}) {
  const result = buildResultOf(part);
  const title =
    part.state === "input-streaming"
      ? `building flowchart · attempt ${attempt}`
      : part.state === "input-available"
        ? `validating flowchart · attempt ${attempt}`
        : part.state === "output-error"
          ? `build failed · attempt ${attempt}`
          : result?.ok
            ? `artifact accepted · attempt ${attempt}`
            : `repair needed · attempt ${attempt}`;

  return (
    <Tool className="studio__tool" defaultOpen={false}>
      <ToolHeader
        state={part.state}
        title={title}
        type="tool-build_flowchart"
      />
      {result ? (
        <div className="studio__tool-report">
          <FlowchartBuildReport attempt={attempt} result={result} />
        </div>
      ) : null}
      <ToolContent>
        {part.input === undefined ? null : <ToolInput input={part.input} />}
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

    if (isFlowchartToolPart(part)) {
      attempt += 1;
      nodes.push(
        <FlowchartToolCard
          attempt={attempt}
          key={part.toolCallId}
          part={part}
        />,
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
          ? "building the canonical flowchart…"
          : "no accepted artifact yet — repair the listed issues or try another flow"}
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
  attemptCount,
  generating,
  ghostLabels,
  result,
  scene,
}: {
  artifact: ReadyPlaygroundArtifact | null;
  attemptCount: number;
  generating: boolean;
  ghostLabels: string[];
  result: BuildFlowchartResult | undefined;
  scene: RenderedDiagramScene | null;
}) {
  const title =
    scene?.title ?? result?.normalizedSpec?.title ?? "Warming up the pencil";
  return (
    <section className="studio__stage">
      <header className="studio__stage-head">
        <div>
          <p className="studio__stage-kicker">canvas</p>
          <h2 className="studio__stage-title">{title}</h2>
        </div>
        <div className="studio__stage-meta">
          {result?.quality ? (
            <span className="studio__stage-chip studio__stage-chip--grade">
              quality {result.quality.score.toFixed(1)}
            </span>
          ) : null}
          {attemptCount > 0 ? (
            <span className="studio__stage-chip">
              attempt {Math.min(attemptCount, 3)} of 3
            </span>
          ) : null}
          {result && !result.ok ? (
            <span className="studio__stage-chip studio__stage-chip--draft">
              repair
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
            rebuilding…
          </div>
        ) : null}
      </div>
      {artifact ? <ArtifactActions artifact={artifact} /> : null}
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
  const busy = status === "submitted" || status === "streaming";

  const toolParts = useMemo(
    () =>
      messages.flatMap((message) => message.parts.filter(isFlowchartToolPart)),
    [messages],
  );
  const buildMode = toolParts.length > 0;

  const completedParts = useMemo(
    () => toolParts.filter((part) => buildResultOf(part) !== undefined),
    [toolParts],
  );
  const displayPart = completedParts.at(-1);
  const activePart = toolParts.find(
    (part) =>
      part.state === "input-streaming" || part.state === "input-available",
  );

  const displayResult = displayPart ? buildResultOf(displayPart) : undefined;
  const acceptedResult = useMemo(
    () =>
      [...completedParts]
        .reverse()
        .map(buildResultOf)
        .find((result) => result?.ok),
    [completedParts],
  );
  const scene = useMemo(
    () => sceneFromResult(acceptedResult),
    [acceptedResult],
  );
  const artifact = useMemo(
    () => (acceptedResult ? artifactFromResponse(acceptedResult) : null),
    [acceptedResult],
  );

  const attemptCount = useMemo(() => {
    const latestRun = [...messages]
      .reverse()
      .find((message) => message.parts.some(isFlowchartToolPart));
    return latestRun?.parts.filter(isFlowchartToolPart).length ?? 0;
  }, [messages]);

  const ghostLabels = useMemo(() => {
    const input = BuildFlowchartRequestSchema.safeParse(activePart?.input);
    if (!input.success) {
      return [];
    }
    return input.data.spec.nodes
      .map((node) => node.label.trim())
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
          <div className="studio__head-brand">
            <a
              aria-label="Sketchi home"
              className="studio__mark"
              href={SKETCHI_WEB_HOME_URL}
            >
              sketchi
            </a>
            <span className="studio__sub">playground · ephemeral</span>
          </div>
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
              attemptCount={attemptCount}
              generating={Boolean(activePart)}
              ghostLabels={ghostLabels}
              result={displayResult}
              scene={scene}
            />
          ) : null}

          <section className="studio__chat" key="chat">
            {isEmpty ? (
              <div className="studio__empty-wrap">
                <div className="studio__empty">
                  <p className="studio__empty-title">What should we draw?</p>
                  <p className="studio__empty-sub">
                    Describe a system or flow — Sketchi builds one canonical
                    artifact and repairs structured issues until it holds up.
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
                  <a
                    className="studio__artifact-link"
                    href="/examples/public-mindmap"
                  >
                    Explore the new public mindmap capability →
                  </a>
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
        </div>
      </main>
    </TooltipProvider>
  );
}
