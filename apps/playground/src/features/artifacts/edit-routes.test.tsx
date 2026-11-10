import { convertSceneToExcalidraw, type ExcalidrawScene } from "@sketchi/diagram-excalidraw";
import { act, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPLOY_PIPELINE_SCENE } from "../playground/deploy-pipeline-sample";

const canvas = vi.hoisted((): { change?: (scene: ExcalidrawScene) => void } => ({}));
vi.mock("@sketchi/diagram-ui", () => ({
	ArtifactCanvas: ({ onSceneChange }: { onSceneChange: (scene: ExcalidrawScene) => void }) => {
		canvas.change = onSceneChange;
		return <div>Route editor</div>;
	},
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: { component: ComponentType }) => ({
		options,
		useParams: () => ({ artifactId: "artifact" }),
	}),
}));
vi.mock("./artifact-view-client", async (original) => ({
	...(await original<typeof import("./artifact-view-client")>()),
	fetchArtifactScene: async () => DEPLOY_PIPELINE_SCENE,
}));
import { Route as ArtifactRoute } from "../../routes/artifacts_/$artifactId/edit";

afterEach(() => vi.restoreAllMocks());
describe("edit route integration", () => {
	it("defers download allocation in the artifact edit route", async () => {
		const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:route");
		const Component = ArtifactRoute.options.component;
		if (!Component) throw new Error("Missing route component");
		render(<Component />);
		expect(document.querySelector('a[href="#"]')).toBeNull();
		expect(await screen.findByText("Route editor")).toBeTruthy();
		const base = convertSceneToExcalidraw(DEPLOY_PIPELINE_SCENE);
		act(() =>
			canvas.change?.({
				...base,
				elements: base.elements.map((element, index) =>
					index === 0 ? { ...element, x: 123, version: 2 } : element,
				),
			}),
		);
		expect(screen.getByRole("link", { name: "Download changes" })).toBeTruthy();
		expect(createObjectURL).not.toHaveBeenCalled();
	});
});
