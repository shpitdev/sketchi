import { createFileRoute } from "@tanstack/react-router";

import { ExcalidrawWorkspace } from "../components/excalidraw-workspace/index.js";
import { SvgIconWorkspace } from "../components/svg-icon-workspace/index.js";
import { parseSvgHandoff, validateSvgHandoffSearch } from "../lib/svg-handoff";

export const Route = createFileRoute("/")({
	validateSearch: validateSvgHandoffSearch,
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
					<h1>Workspace import unavailable</h1>
					<span>{handoff.message}</span>
					<a href="/">Return to sample workspace</a>
				</div>
			</main>
		);
	}
	return <ExcalidrawWorkspace />;
}
