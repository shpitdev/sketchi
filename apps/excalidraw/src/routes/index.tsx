import { createFileRoute } from "@tanstack/react-router";

import { ExcalidrawWorkspace } from "../components/excalidraw-workspace/index.js";
import { SvgIconWorkspace } from "../components/svg-icon-workspace/index.js";
import { parseSvgHandoff, type SvgHandoffSearch } from "../lib/svg-handoff";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function roughnessValue(value: unknown): 0 | 1 | 2 | undefined {
  if (value === 0 || value === "0") return 0;
  if (value === 2 || value === "2") return 2;
  if (value === 1 || value === "1") return 1;
  return undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (search): SvgHandoffSearch => ({
    color: stringValue(search.color),
    colorMode: stringValue(search.colorMode),
    fillStyle: stringValue(search.fillStyle),
    roughness: roughnessValue(search.roughness),
    svg: stringValue(search.svg),
  }),
  component: HomeRoute,
});

function HomeRoute() {
  const search = Route.useSearch();
  const handoff = parseSvgHandoff(search);

  if (handoff.kind === "valid") {
    return <SvgIconWorkspace handoff={handoff.handoff} />;
  }
  if (handoff.kind === "invalid") {
    return (
      <main className="svg-handoff-error">
        <div>
          <p>SVG handoff blocked</p>
          <h1>Workspace import unavailable</h1>
          <span>{handoff.message}</span>
          <a href="/">Return to sample workspace</a>
        </div>
      </main>
    );
  }
  return <ExcalidrawWorkspace />;
}
