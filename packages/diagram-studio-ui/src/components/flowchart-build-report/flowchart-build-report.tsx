import type {
  BuildFlowchartResult,
  CodeModeIssue,
} from "@sketchi/diagram-agent";

export interface FlowchartBuildReportProps {
  attempt: number;
  maxAttempts?: number;
  result: BuildFlowchartResult;
}

function issueLocation(issue: CodeModeIssue): string | undefined {
  if (!issue.ref) {
    return undefined;
  }
  return issue.ref.id ?? issue.ref.path ?? issue.ref.kind;
}

function statusLabel(result: BuildFlowchartResult): string {
  if (result.ok) {
    return "Canonical artifact accepted";
  }
  if (
    result.status === "invalid_input" ||
    result.status === "invalid_flowchart" ||
    result.status === "quality_failed"
  ) {
    return "Repair the flowchart";
  }
  return "Build needs attention";
}

function statusTone(result: BuildFlowchartResult): string {
  if (result.ok) {
    return "accepted";
  }
  return result.status === "render_failed" ||
    result.status === "export_failed" ||
    result.status === "storage_failed"
    ? "failed"
    : "repair";
}

function resultSummary(result: BuildFlowchartResult): {
  edgeCount?: number;
  nodeCount?: number;
  score?: number;
} {
  if (result.quality) {
    return {
      edgeCount: result.quality.summary.edgeCount,
      nodeCount: result.quality.summary.nodeCount,
      score: result.quality.score,
    };
  }
  if (result.normalizedSpec) {
    return {
      edgeCount: result.normalizedSpec.edges.length,
      nodeCount: result.normalizedSpec.nodes.length,
    };
  }
  return {};
}

export function FlowchartBuildReport({
  attempt,
  maxAttempts = 3,
  result,
}: FlowchartBuildReportProps) {
  const summary = resultSummary(result);
  const tone = statusTone(result);

  return (
    <section className="sketchi-flowchart-build-report" data-status={tone}>
      <header className="sketchi-flowchart-build-report__header">
        <div>
          <p className="sketchi-flowchart-build-report__status">
            {statusLabel(result)}
          </p>
          <p className="sketchi-flowchart-build-report__attempt">
            Attempt {Math.min(attempt, maxAttempts)} of {maxAttempts}
          </p>
        </div>
        <div className="sketchi-flowchart-build-report__metrics">
          {summary.score === undefined ? null : (
            <span>{summary.score.toFixed(1)} quality</span>
          )}
          {summary.nodeCount === undefined ? null : (
            <span>{summary.nodeCount} nodes</span>
          )}
          {summary.edgeCount === undefined ? null : (
            <span>{summary.edgeCount} edges</span>
          )}
        </div>
      </header>

      {result.ok ? (
        <p className="sketchi-flowchart-build-report__accepted">
          Saved as one canonical artifact. Scene and drawing exports are ready.
        </p>
      ) : result.issues.length > 0 ? (
        <ol className="sketchi-flowchart-build-report__issues">
          {result.issues.map((issue, index) => {
            const location = issueLocation(issue);
            return (
              <li key={`${issue.code}-${location ?? "build"}-${index}`}>
                <div className="sketchi-flowchart-build-report__issue-head">
                  <code>{issue.code}</code>
                  <span>{issue.stage}</span>
                  {location ? <span>{location}</span> : null}
                </div>
                <p>{issue.message}</p>
                <small>{issue.hint}</small>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
