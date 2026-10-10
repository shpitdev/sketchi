import type {
	DiagramGenerationCacheMode,
	DiagramGenerationCandidateSummary,
	DiagramGenerationProviderId,
} from "@sketchi/diagram-generation";
import {
	evaluateScenarioFixture,
	evaluateScenarioOutput,
	flowchartScenarios,
	type DiagramScenario,
	type ScenarioEvaluation,
} from "@sketchi/diagram-scenarios";
import { useStore } from "@tanstack/react-store";
import { useMemo, useState } from "react";

import type { ScenarioSuitePanelResult } from "../scenario-suite-panel/index.js";
import { createPlaygroundStore } from "./playground-store.js";
import { PlaygroundControls } from "./playground-controls.js";
import { PlaygroundCanvas } from "./playground-canvas.js";
import { PlaygroundInspector } from "./playground-inspector.js";

export interface ScenarioGenerationRequest {
	cacheMode: DiagramGenerationCacheMode;
	providers: readonly DiagramGenerationProviderId[];
	scenarioId: string;
}

export interface ScenarioGenerationResult {
	candidates: readonly DiagramGenerationCandidateSummary[];
	scenarioId: string;
}

export interface ScenarioPlaygroundProps {
	initialScenarioId?: string;
	onGenerateScenario?: (request: ScenarioGenerationRequest) => Promise<ScenarioGenerationResult>;
	scenarios?: readonly DiagramScenario[];
}

export interface EvaluationState {
	error?: string;
	result?: ScenarioEvaluation;
}

function evaluateCandidate(scenario: DiagramScenario, candidateText: string): EvaluationState {
	if (candidateText.trim().length === 0) {
		return {};
	}

	try {
		return {
			result: evaluateScenarioOutput(scenario, candidateText),
		};
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Candidate evaluation failed",
		};
	}
}

const defaultGenerationProviders: readonly DiagramGenerationProviderId[] = [
	"cloudflare-google-ai-studio",
];

function pickCandidateText(
	candidates: readonly DiagramGenerationCandidateSummary[],
): string | undefined {
	const validCandidate = candidates.find(
		(generationCandidate) => !generationCandidate.error && generationCandidate.diagramValid,
	);

	return (
		validCandidate?.diagramText ??
		validCandidate?.text ??
		candidates.find((candidate) => candidate.text)?.text
	);
}

function suiteRunResult(
	result: Omit<ScenarioSuitePanelResult, "durationMs"> & {
		durationMs: number | undefined;
	},
): ScenarioSuitePanelResult {
	const { durationMs, ...requiredResult } = result;

	return durationMs === undefined ? requiredResult : { ...requiredResult, durationMs };
}

function summarizeSuiteRun(
	scenario: DiagramScenario,
	candidates: readonly DiagramGenerationCandidateSummary[],
): ScenarioSuitePanelResult {
	const firstCandidate = candidates[0];
	const candidateText = pickCandidateText(candidates);

	if (!candidateText) {
		return suiteRunResult({
			durationMs: firstCandidate?.durationMs,
			message: firstCandidate?.error ?? "No generated candidate returned.",
			scenarioId: scenario.id,
			status: "fail",
			title: scenario.title,
		});
	}

	const evaluation = evaluateCandidate(scenario, candidateText);
	const failedChecks = evaluation.result?.checks.filter((check) => !check.passed) ?? [];

	return suiteRunResult({
		durationMs: firstCandidate?.durationMs,
		message: evaluation.error
			? evaluation.error
			: evaluation.result?.ok
				? "Passed deterministic checks"
				: failedChecks.map((check) => check.message).join(" "),
		scenarioId: scenario.id,
		status: evaluation.result?.ok ? "pass" : "fail",
		title: scenario.title,
	});
}

export function ScenarioPlayground({
	initialScenarioId,
	onGenerateScenario,
	scenarios = flowchartScenarios,
}: ScenarioPlaygroundProps) {
	const [{ store, actions }] = useState(() => createPlaygroundStore(scenarios, initialScenarioId));
	const state = useStore(store, (current) => current);
	const selectedScenario =
		scenarios.find((scenario) => scenario.id === state.scenarioId) ?? scenarios[0];

	const fixtureEvaluation = useMemo(
		() => (selectedScenario ? evaluateScenarioFixture(selectedScenario) : undefined),
		[selectedScenario],
	);
	const candidateEvaluation = useMemo(
		() => (selectedScenario ? evaluateCandidate(selectedScenario, state.candidateText) : undefined),
		[selectedScenario, state.candidateText],
	);
	const activeEvaluation: EvaluationState =
		state.mode === "llm"
			? (candidateEvaluation ?? {})
			: fixtureEvaluation
				? { result: fixtureEvaluation }
				: {};
	const activeResult = activeEvaluation?.result;
	const busy = state.generationStatus === "running" || state.suiteStatus === "running";
	const statusOk =
		state.mode === "llm"
			? Boolean(candidateEvaluation?.result?.ok) && !candidateEvaluation?.error
			: Boolean(fixtureEvaluation?.ok);
	const hasCandidateText = state.candidateText.trim().length > 0;
	const statusLabel =
		state.mode === "llm" && state.generationStatus === "running"
			? "Running"
			: state.mode === "llm" && !hasCandidateText && state.generationStatus === "idle"
				? "Ready"
				: statusOk
					? "Passing"
					: "Needs attention";
	const statusClass =
		statusLabel === "Passing"
			? "sketchi-scenario-playground__status"
			: statusLabel === "Ready" || statusLabel === "Running"
				? "sketchi-scenario-playground__status sketchi-scenario-playground__status--ready"
				: "sketchi-scenario-playground__status sketchi-scenario-playground__status--failed";
	async function runScenario(scenario: DiagramScenario, focusCandidate: boolean) {
		if (!onGenerateScenario) {
			return undefined;
		}

		const runToken = store.state.generationRunToken;
		const generationResult = await onGenerateScenario({
			cacheMode: store.state.cacheMode,
			providers: defaultGenerationProviders,
			scenarioId: scenario.id,
		});
		const suiteSummary = summarizeSuiteRun(scenario, generationResult.candidates);

		actions.updateSuiteResult(suiteSummary);
		actions.applyRunResult(
			scenario.id,
			generationResult,
			runToken,
			focusCandidate,
			pickCandidateText(generationResult.candidates) ?? "",
		);

		return generationResult;
	}

	async function runGeneration() {
		if (
			!selectedScenario ||
			!onGenerateScenario ||
			store.state.generationStatus === "running" ||
			store.state.suiteStatus === "running"
		) {
			return;
		}

		const runToken = actions.startGeneration();

		try {
			await runScenario(selectedScenario, true);
		} catch (error) {
			actions.failGeneration(selectedScenario.id, runToken, error);
		} finally {
			actions.finishGeneration();
		}
	}

	async function runSelectedSuite() {
		if (
			!onGenerateScenario ||
			store.state.generationStatus === "running" ||
			store.state.suiteStatus === "running"
		) {
			return;
		}

		const selectedScenarios = scenarios.filter((scenario) =>
			state.selectedSuiteScenarioIds.includes(scenario.id),
		);

		if (selectedScenarios.length === 0) {
			return;
		}

		actions.startSuite();

		try {
			for (const scenario of selectedScenarios) {
				actions.updateSuiteResult({
					message: "Running",
					scenarioId: scenario.id,
					status: "running",
					title: scenario.title,
				});

				await runScenario(scenario, scenario.id === selectedScenario?.id);
			}

			actions.completeSuite();
		} catch (error) {
			actions.failSuite(error);
		}
	}

	return (
		<section className="sketchi-scenario-playground">
			<header className="sketchi-scenario-playground__header">
				<div>
					<p className="sketchi-scenario-playground__eyebrow">Eval Harness</p>
					<h1>Sketchi scenario harness</h1>
				</div>
				<span className={statusClass}>{statusLabel}</span>
			</header>

			<div className="sketchi-scenario-playground__layout">
				<PlaygroundControls
					actions={actions}
					activeEvaluation={activeEvaluation}
					busy={busy}
					canGenerate={Boolean(onGenerateScenario)}
					hasCandidateText={hasCandidateText}
					runGeneration={runGeneration}
					scenarios={scenarios}
					selectedScenario={selectedScenario}
					state={state}
				/>
				<PlaygroundCanvas
					actions={actions}
					activeResult={activeResult}
					selectedScenario={selectedScenario}
					state={state}
				/>
				<PlaygroundInspector
					actions={actions}
					activeResult={activeResult}
					busy={busy}
					canGenerate={Boolean(onGenerateScenario)}
					hasCandidateText={hasCandidateText}
					runSelectedSuite={runSelectedSuite}
					scenarios={scenarios}
					selectedScenario={selectedScenario}
					state={state}
				/>
			</div>
		</section>
	);
}
