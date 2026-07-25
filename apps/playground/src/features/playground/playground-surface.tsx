import type { BuildFlowchartResult } from "@sketchi/diagram-agent";
import { DiagramPreview } from "@sketchi/diagram-ui";
import type { ChatStatus, UIMessage } from "ai";
import type { RefObject } from "react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputProps,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { IconActionBar, IconLink } from "@/components/sketch-icons";
import { Suggestion } from "@/components/ai-elements/suggestion";

import { DEPLOY_PIPELINE_SCENE } from "./deploy-pipeline-sample";

const STARTERS = [
  "Sketch a login flow with retries and a fraud check",
  "Diagram a CI/CD pipeline from commit to production",
  "Map the data flow for an AI chat app with streaming",
];

const DEPLOY_PIPELINE_BRANDS = [
  { name: "GitHub", logo: "/brand/github.svg" },
  { name: "Docker", logo: "/brand/docker.svg" },
  { name: "Cloudflare", logo: "/brand/cloudflare.svg" },
] as const;

export interface ReadyPlaygroundArtifact {
  artifactId: string;
  exportUrls: {
    excalidraw: string;
    scene: string;
  };
  editUrl: string;
  viewUrl: string;
}

export function ArtifactActions({
  artifact,
}: {
  artifact: ReadyPlaygroundArtifact;
}) {
  return (
    <div className="studio__artifact-actions">
      <IconActionBar aria-label="Diagram actions">
        <IconLink
          href={artifact.viewUrl}
          icon="open"
          label="View diagram"
          showLabel
        />
        <IconLink
          href={artifact.editUrl}
          icon="edit"
          label="Edit diagram"
          showLabel
        />
        <IconLink
          download={`${artifact.artifactId}.json`}
          href={artifact.exportUrls.scene}
          icon="scene"
          label="Download JSON"
          showLabel
        />
        <IconLink
          download={`${artifact.artifactId}.excalidraw`}
          href={artifact.exportUrls.excalidraw}
          icon="drawing"
          label="Download Excalidraw"
          showLabel
        />
      </IconActionBar>
      <p className="studio__note">Shareable by link · no account yet</p>
    </div>
  );
}

function resultSummary(result: BuildFlowchartResult): {
  connectionCount?: number;
  itemCount?: number;
  score?: number;
} {
  if (result.quality) {
    return {
      connectionCount: result.quality.summary.edgeCount,
      itemCount: result.quality.summary.nodeCount,
      score: result.quality.score,
    };
  }
  if (result.normalizedSpec) {
    return {
      connectionCount: result.normalizedSpec.edges.length,
      itemCount: result.normalizedSpec.nodes.length,
    };
  }
  return {};
}

export function BuildResultDetails({
  pass,
  result,
}: {
  pass: number;
  result: BuildFlowchartResult;
}) {
  const summary = resultSummary(result);
  const guidance = result.ok ? null : failureCopy(result.status);

  return (
    <div className="studio__build-result">
      <p className="studio__build-result-summary">
        {result.ok
          ? "Your diagram is ready to view, edit, or download."
          : "This version needs a few changes before it is ready."}
      </p>

      {guidance ? (
        <ul className="studio__build-issues">
          <li>
            <p>{guidance.message}</p>
            <small>{guidance.hint}</small>
          </li>
        </ul>
      ) : null}

      <details className="studio__build-disclosure">
        <summary>Drawing details</summary>
        <dl>
          {summary.score === undefined ? null : (
            <div>
              <dt>Diagram score</dt>
              <dd>{summary.score.toFixed(1)}</dd>
            </div>
          )}
          {summary.itemCount === undefined ? null : (
            <div>
              <dt>Diagram items</dt>
              <dd>{summary.itemCount}</dd>
            </div>
          )}
          {summary.connectionCount === undefined ? null : (
            <div>
              <dt>Connections</dt>
              <dd>{summary.connectionCount}</dd>
            </div>
          )}
          <div>
            <dt>Drawing pass</dt>
            <dd>{pass}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

function failureCopy(
  status: Exclude<BuildFlowchartResult, { ok: true }>["status"],
): { hint: string; message: string } {
  switch (status) {
    case "invalid_input":
      return {
        message: "I couldn’t understand part of that diagram request.",
        hint: "Describe the main steps and how they connect, then try again.",
      };
    case "invalid_flowchart":
      return {
        message: "This draft needs a clearer structure before it can be drawn.",
        hint: "Clarify the steps or simplify the connections, then try again.",
      };
    case "quality_failed":
      return {
        message: "This draft needs another pass before it is ready.",
        hint: "Ask Sketchi to simplify the flow or try a shorter description.",
      };
    case "render_failed":
      return {
        message: "The diagram could not be drawn this time.",
        hint: "Try again, or ask for a simpler version.",
      };
    case "export_failed":
      return {
        message: "The diagram was drawn, but its downloads are not ready.",
        hint: "Try generating the diagram again.",
      };
    case "storage_failed":
      return {
        message: "The diagram could not be saved this time.",
        hint: "Try again in a moment.",
      };
  }
}

export function assistantAsksQuestion(message: UIMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }

  const lastText = [...message.parts]
    .reverse()
    .find((part) => part.type === "text" && part.text.trim().length > 0);

  return lastText?.type === "text" && lastText.text.trimEnd().endsWith("?");
}

export function AssistantFollowUp({
  onCompose,
  onSelect,
}: {
  onCompose: () => void;
  onSelect: (answer: string) => void;
}) {
  return (
    <div aria-label="Answer this question" className="studio__follow-ups">
      <Suggestion onClick={onSelect} suggestion="Yes, make that change" />
      <Suggestion onClick={onSelect} suggestion="No, keep it as is" />
      <Suggestion onClick={onCompose} suggestion="Write another answer" />
    </div>
  );
}

export function PlaygroundEmptyState({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="studio__empty-wrap">
      <section
        aria-labelledby="playground-empty-title"
        className="studio__empty"
      >
        <div className="studio__empty-copy">
          <p className="studio__empty-kicker">Start with a sketch</p>
          <h1 className="studio__empty-title" id="playground-empty-title">
            What should we draw?
          </h1>
          <p className="studio__empty-sub">
            Describe a system or flow. Sketchi drafts a diagram you can refine
            as you talk.
          </p>
        </div>

        <figure className="studio__sample">
          <figcaption className="studio__sample-caption">
            <span>Deploy pipeline</span>
            <ul
              aria-label="GitHub to Docker to Cloudflare"
              className="studio__sample-brand-path"
            >
              {DEPLOY_PIPELINE_BRANDS.map((brand) => (
                <li key={brand.name}>
                  <img
                    alt={`${brand.name} logo`}
                    height="18"
                    src={brand.logo}
                    width="18"
                  />
                </li>
              ))}
            </ul>
            <span>Rendered in Sketchi</span>
          </figcaption>
          <div className="studio__sample-canvas">
            <DiagramPreview scene={DEPLOY_PIPELINE_SCENE} />
          </div>
        </figure>

        <div aria-label="Starter prompts" className="studio__starters">
          {STARTERS.map((starter) => (
            <Suggestion
              className="studio__starter"
              key={starter}
              onClick={onSelect}
              suggestion={starter}
            />
          ))}
        </div>

        <aside className="studio__announcement">
          <span className="studio__announcement-kicker">New sketch type</span>
          <span className="studio__announcement-copy">
            Mind maps are ready to explore.
          </span>
          <a href="/examples/public-mindmap">View the example →</a>
        </aside>
      </section>
    </div>
  );
}

export function PlaygroundComposer({
  buildMode,
  composerRef,
  onSubmit,
  status,
}: {
  buildMode: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: PromptInputProps["onSubmit"];
  status: ChatStatus;
}) {
  return (
    <div className="studio__composer">
      <PromptInput onSubmit={onSubmit}>
        <PromptInputBody>
          <label className="sr-only" htmlFor="playground-composer">
            Describe your diagram
          </label>
          <PromptInputTextarea
            id="playground-composer"
            ref={composerRef}
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
  );
}
