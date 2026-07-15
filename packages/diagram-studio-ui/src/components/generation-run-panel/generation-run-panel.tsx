import type {
  DiagramGenerationCacheMode,
  DiagramGenerationCandidateSummary,
  DiagramGenerationProviderId,
} from "@sketchi/diagram-generation";

export interface GenerationRunPanelProps {
  cacheMode?: DiagramGenerationCacheMode;
  candidates?: readonly DiagramGenerationCandidateSummary[];
  disabled?: boolean;
  error?: string;
  onCacheModeChange?: (cacheMode: DiagramGenerationCacheMode) => void;
  onRun?: () => void;
  providers?: readonly GenerationRunProvider[];
  running?: boolean;
  title?: string;
}

export interface GenerationRunProvider {
  id: DiagramGenerationProviderId;
  label: string;
}

const defaultProviders: readonly GenerationRunProvider[] = [
  { id: "cloudflare-google-ai-studio", label: "Sketchi model" },
];

function providerCandidate(
  candidates: readonly DiagramGenerationCandidateSummary[],
  providerId: DiagramGenerationProviderId,
): DiagramGenerationCandidateSummary | undefined {
  return candidates.find((candidate) => candidate.provider === providerId);
}

function providerStatus(
  candidate: DiagramGenerationCandidateSummary | undefined,
) {
  if (!candidate) {
    return "Ready";
  }

  if (candidate.error) {
    return "Failed";
  }

  if (candidate.diagramValid) {
    return "Valid IR";
  }

  return "Returned";
}

function statusAttribute(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function tokenSummary(
  candidate: DiagramGenerationCandidateSummary,
): string | undefined {
  if (candidate.usage?.totalTokens === undefined) {
    return undefined;
  }

  return `${candidate.usage.totalTokens} tokens`;
}

function diagnosticSummary(
  candidate: DiagramGenerationCandidateSummary,
): string | undefined {
  const diagnostics = candidate.diagnostics.filter(
    (diagnostic) => diagnostic !== candidate.error,
  );

  return diagnostics.length > 0 ? diagnostics.join(" ") : undefined;
}

function candidateMetrics(
  candidate: DiagramGenerationCandidateSummary | undefined,
): string | undefined {
  if (!candidate) {
    return undefined;
  }

  const duration =
    candidate.durationMs === undefined
      ? undefined
      : `${candidate.durationMs} ms`;
  const tokens = tokenSummary(candidate);

  return [duration, tokens].filter(Boolean).join(" / ") || undefined;
}

export function GenerationRunPanel({
  cacheMode = "default",
  candidates = [],
  disabled = false,
  error,
  onCacheModeChange,
  onRun,
  providers = defaultProviders,
  running = false,
  title = "Live run",
}: GenerationRunPanelProps) {
  const primaryCandidate = providers
    .map((provider) => providerCandidate(candidates, provider.id))
    .find(Boolean);
  const primaryStatus = running ? "Running" : providerStatus(primaryCandidate);
  const primaryMetrics = candidateMetrics(primaryCandidate);

  return (
    <section className="sketchi-generation-run-panel">
      <header>
        <h2>{title}</h2>
        <button
          disabled={disabled || running || !onRun}
          onClick={onRun}
          type="button"
        >
          {running ? "Running" : "Run"}
        </button>
      </header>

      {error ? (
        <p className="sketchi-generation-run-panel__error">{error}</p>
      ) : null}

      <p
        className="sketchi-generation-run-panel__summary"
        data-status={statusAttribute(primaryStatus)}
      >
        <strong>{primaryStatus}</strong>
        {primaryMetrics ? <span>{primaryMetrics}</span> : null}
      </p>

      <details
        className="sketchi-generation-run-panel__settings"
        open={cacheMode === "fresh"}
      >
        <summary>Run settings</summary>
        <fieldset className="sketchi-generation-run-panel__cache-mode">
          <legend>Cache</legend>
          {(["default", "fresh"] as const).map((mode) => (
            <label key={mode}>
              <input
                checked={cacheMode === mode}
                disabled={disabled || running}
                name="generation-cache-mode"
                onChange={() => onCacheModeChange?.(mode)}
                type="radio"
                value={mode}
              />
              {mode === "fresh" ? "Fresh" : "Default"}
            </label>
          ))}
        </fieldset>

        <ul>
          {providers.map((provider) => {
            const candidate = providerCandidate(candidates, provider.id);
            const status = providerStatus(candidate);
            const metrics = candidateMetrics(candidate);
            const diagnostics = candidate
              ? diagnosticSummary(candidate)
              : undefined;

            return (
              <li data-status={statusAttribute(status)} key={provider.id}>
                <div>
                  <span>{provider.label}</span>
                  <strong>{status}</strong>
                </div>
                {candidate?.model ? <code>{candidate.model}</code> : null}
                {candidate?.error ? <p>{candidate.error}</p> : null}
                {diagnostics ? (
                  <p className="sketchi-generation-run-panel__diagnostics">
                    {diagnostics}
                  </p>
                ) : null}
                {metrics ? <small>{metrics}</small> : null}
                {candidate?.cacheMode ? (
                  <small>
                    {candidate.cacheMode === "fresh" ? "Fresh" : "Default"} run
                  </small>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
