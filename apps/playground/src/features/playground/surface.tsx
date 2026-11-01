import type { StudioBuildResult } from "./build-result";
import { DiagramPreview } from "@sketchi/diagram-ui";
import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useState, type RefObject } from "react";

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

/** Each chip shows a short label and sends the full prompt. */
const STARTERS = [
	{ label: "Login flow", prompt: "Sketch a login flow with retries and a fraud check" },
	{ label: "CI/CD pipeline", prompt: "Diagram a CI/CD pipeline from commit to production" },
	{
		label: "Checkout sequence",
		prompt: "Show checkout as a sequence diagram: browser, API, payments",
	},
];

export interface ReadyPlaygroundArtifact {
	artifactId: string;
	exportUrls: {
		excalidraw: string;
		scene: string;
	};
	editUrl: string;
	viewUrl: string;
}

export function ArtifactActions({ artifact }: { artifact: ReadyPlaygroundArtifact }) {
	return (
		<div className="studio__artifact-actions">
			<IconActionBar aria-label="Diagram actions">
				<IconLink href={artifact.viewUrl} icon="open" label="View diagram" showLabel />
				<IconLink href={artifact.editUrl} icon="edit" label="Edit diagram" showLabel />
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
			<p className="studio__note">Anyone with the link can view it · not tied to an account</p>
		</div>
	);
}

function resultSummary(result: StudioBuildResult): {
	connectionCount?: number;
	itemCount?: number;
	score?: number;
} {
	const spec = result.normalizedSpec;
	// Timeline events and chart values sit on axes, and wireframe components on screens; they have no connections to count.
	const unconnected =
		spec !== undefined && ("events" in spec || "categories" in spec || "screens" in spec);
	if (result.quality) {
		return {
			...(unconnected ? {} : { connectionCount: result.quality.summary.edgeCount }),
			itemCount: result.quality.summary.nodeCount,
			score: result.quality.score,
		};
	}
	if (!spec) return {};
	if ("events" in spec) return { itemCount: spec.events.length };
	if ("categories" in spec) return { itemCount: spec.categories.length * spec.series.length };
	if ("states" in spec)
		return { connectionCount: spec.transitions.length, itemCount: spec.states.length };
	if ("tasks" in spec)
		return {
			connectionCount: spec.tasks.reduce((count, task) => count + (task.dependsOn?.length ?? 0), 0),
			itemCount: spec.tasks.length,
		};
	if ("entities" in spec)
		return { connectionCount: spec.relationships.length, itemCount: spec.entities.length };
	if ("classes" in spec)
		return { connectionCount: spec.relationships.length, itemCount: spec.classes.length };
	if ("regions" in spec)
		return {
			connectionCount: spec.regions.length,
			itemCount: spec.regions.reduce((sum, region) => sum + (region.items?.length ?? 0), 0),
		};
	if ("links" in spec) return { connectionCount: spec.links.length, itemCount: spec.nodes.length };
	if ("screens" in spec) {
		const count = (components: readonly { children?: readonly unknown[] }[]): number =>
			components.reduce(
				(sum, component) =>
					sum + 1 + count((component.children ?? []) as { children?: readonly unknown[] }[]),
				0,
			);
		return { itemCount: spec.screens.reduce((sum, screen) => sum + count(screen.children), 0) };
	}
	if ("people" in spec)
		return {
			connectionCount:
				spec.people.filter((person) => person.manager !== undefined).length +
				spec.dottedLines.length,
			itemCount: spec.people.length,
		};
	if ("stages" in spec)
		return {
			connectionCount: 0,
			itemCount: spec.stages.reduce((count, stage) => count + stage.steps.length, 0),
		};
	if ("quadrants" in spec) return { itemCount: spec.points.length };
	return "participants" in spec
		? { connectionCount: spec.messages.length, itemCount: spec.participants.length }
		: { connectionCount: spec.edges.length, itemCount: spec.nodes.length };
}

export function BuildResultDetails({ pass, result }: { pass: number; result: StudioBuildResult }) {
	const summary = resultSummary(result);
	const guidance = result.ok ? null : failureCopy(result.status);

	return (
		<div className="studio__build-result">
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

function failureCopy(status: Exclude<StudioBuildResult, { ok: true }>["status"]): {
	hint: string;
	message: string;
} {
	switch (status) {
		case "invalid_input":
			return {
				message: "I couldn’t understand part of that diagram request.",
				hint: "Describe the main steps and how they connect, then try again.",
			};
		case "invalid_flowchart":
		case "invalid_sequence":
		case "invalid_timeline":
		case "invalid_chart":
		case "invalid_state_machine":
		case "invalid_gantt":
		case "invalid_er_diagram":
		case "invalid_class_diagram":
		case "invalid_org_chart":
		case "invalid_venn_diagram":
		case "invalid_journey":
		case "invalid_sankey":
		case "invalid_wireframe":
		case "invalid_quadrant_chart":
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

export function AssistantFollowUp({ onCompose }: { onCompose: () => void }) {
	return (
		<div aria-label="Answer this question" className="studio__follow-ups">
			<Suggestion onClick={onCompose} suggestion="Write another answer" />
		</div>
	);
}

/** The first-visit heading; the composer renders directly beneath it. */
export function PlaygroundIntro() {
	return <h1 className="studio__intro">What should we draw?</h1>;
}

/**
 * Excalidraw fits a scene to its viewport once, on load. When the sample's
 * frame changes width (rotation, window resize) a new revision remounts the
 * preview so the whole diagram fits again.
 */
function useWidthRevision() {
	const [revision, setRevision] = useState(0);
	const observeWidth = useCallback((element: HTMLDivElement | null) => {
		if (!element || typeof ResizeObserver === "undefined") return;
		let width = element.getBoundingClientRect().width;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(([entry]) => {
			const next = entry?.contentRect.width ?? width;
			if (Math.abs(next - width) < 1) return;
			width = next;
			clearTimeout(timer);
			timer = setTimeout(() => setRevision((value) => value + 1), 200);
		});
		observer.observe(element);
		return () => {
			clearTimeout(timer);
			observer.disconnect();
		};
	}, []);

	return { observeWidth, revision: `deploy-pipeline-${revision}` };
}

/** Starter prompts and a sample diagram, shown under the empty composer. */
export function PlaygroundStarters({ onSelect }: { onSelect: (prompt: string) => void }) {
	const { observeWidth, revision } = useWidthRevision();
	return (
		<div className="studio__starters-wrap">
			<div aria-label="Starter prompts" className="studio__starters">
				{STARTERS.map(({ label, prompt }) => (
					<Suggestion
						className="studio__starter"
						key={label}
						onClick={onSelect}
						suggestion={prompt}
						title={prompt}
					>
						{label}
					</Suggestion>
				))}
			</div>

			<figure className="studio__sample">
				<figcaption className="studio__sample-caption">Example: deploy pipeline</figcaption>
				<div className="studio__sample-canvas" ref={observeWidth}>
					<DiagramPreview revision={revision} scene={DEPLOY_PIPELINE_SCENE} />
				</div>
			</figure>
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
							buildMode ? "Ask for changes to the sketch…" : "Describe a system or flow…"
						}
					/>
				</PromptInputBody>
				<PromptInputFooter className="justify-end">
					{/* After a failed request the button still sends (a retry), so it keeps
					    the send glyph; the error message above says what went wrong. */}
					<PromptInputSubmit
						aria-label={status === "submitted" || status === "streaming" ? "Stop" : "Send"}
						status={status === "error" ? "ready" : status}
					/>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
