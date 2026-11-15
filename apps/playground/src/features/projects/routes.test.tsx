import { RegistryProvider } from "@effect/atom-react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEPLOY_PIPELINE_SCENE } from "../playground/deploy-pipeline-sample";

const params = vi.hoisted(() => ({
	artifactId: "artifact_one",
	projectId: "proj_owner",
	diagramId: "dia_owner",
}));
vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: { component: ComponentType }) => ({
		options,
		useParams: () => params,
	}),
}));
vi.mock("@sketchi/editor", () => ({
	DrawingEditor: ({ title }: { title: string }) => <div>{title}</div>,
}));
import { Route as Review } from "../../routes/artifacts/$artifactId";
import { Route as Edit } from "../../routes/artifacts_/$artifactId/edit";
import { Route as Projects } from "../../routes/projects";
import { Route as Project } from "../../routes/projects_/$projectId";
import { Route as Diagram } from "../../routes/diagrams/$diagramId";
import { Route as DiagramEdit } from "../../routes/diagrams_/$diagramId/edit";

const project = {
	id: "proj_owner",
	title: "Saved artifact",
	createdAt: "2026-11-15T00:00:00Z",
	updatedAt: "2026-11-15T00:00:00Z",
	diagramCount: 1,
	primaryDiagramId: "dia_owner",
	source: { kind: "playground-artifact", artifactId: "artifact_one" },
};
const created = {
	ok: true,
	auth: { status: "anonymous", message: "Anonymous" },
	session: { kind: "anonymous" },
	project,
	diagram: {
		id: "dia_owner",
		projectId: project.id,
		title: project.title,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
		source: project.source,
		artifactId: "artifact_one",
		editUrl: "/diagrams/dia_owner/edit",
		reviewUrl: "/diagrams/dia_owner",
	},
	urls: {
		project: "/projects/proj_owner",
		diagram: "/diagrams/dia_owner",
		edit: "/diagrams/dia_owner/edit",
	},
};
const scene = () => Response.json({ ok: true, inline: DEPLOY_PIPELINE_SCENE });
const fetcher = vi.fn<typeof fetch>();
function component(route: { options: { component?: ComponentType } }) {
	if (!route.options.component) throw new Error("Missing route component");
	return route.options.component;
}
function page(Component: ComponentType) {
	return (
		<RegistryProvider>
			<Component />
		</RegistryProvider>
	);
}
beforeEach(() => {
	params.artifactId = "artifact_one";
	fetcher.mockReset();
	vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe("actual Studio route consumers", () => {
	it.each([Review, Edit, Projects, Project, Diagram, DiagramEdit])(
		"renders server snapshots without acquiring HTTP or browser storage",
		(route) => {
			const Component = component(route);
			const original = Object.getOwnPropertyDescriptor(window, "indexedDB");
			const getStorage = vi.fn(() => {
				throw new Error("SSR storage access");
			});
			Object.defineProperty(window, "indexedDB", { configurable: true, get: getStorage });
			try {
				renderToString(page(Component));
				expect(fetcher).not.toHaveBeenCalled();
				expect(getStorage).not.toHaveBeenCalled();
			} finally {
				if (original) Object.defineProperty(window, "indexedDB", original);
				else Reflect.deleteProperty(window, "indexedDB");
			}
		},
	);
	it("makes review actions unavailable during loading, failure and missing results, then recovers on navigation", async () => {
		const pending = Promise.withResolvers<Response>();
		fetcher.mockReturnValueOnce(pending.promise);
		const Component = component(Review);
		const view = render(page(Component));
		for (const name of ["Save to Studio", "Edit", "Scene file", "Drawing file"])
			expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
		await act(async () => pending.resolve(new Response("missing", { status: 404 })));
		expect(await screen.findByText("Artifact could not be loaded.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save to Studio" }));
		expect(fetcher).toHaveBeenCalledTimes(1);
		fetcher.mockResolvedValueOnce(scene());
		params.artifactId = "artifact_two";
		view.rerender(page(Component));
		expect(await screen.findByRole("link", { name: "Edit" })).toHaveProperty(
			"href",
			window.location.origin + "/artifacts/artifact_two/edit",
		);
		expect(screen.getByRole("button", { name: "Save to Studio" })).toHaveProperty(
			"disabled",
			false,
		);
	});
	it("interrupts old route requests and ignores a late response after replacement or unmount", async () => {
		const pending = Promise.withResolvers<Response>();
		let signal: AbortSignal | undefined;
		fetcher
			.mockImplementationOnce(async (_url, init) => {
				signal = init?.signal ?? undefined;
				return pending.promise;
			})
			.mockResolvedValueOnce(scene());
		const Component = component(Review);
		const view = render(page(Component));
		await waitFor(() => expect(signal).toBeTruthy());
		params.artifactId = "artifact_two";
		view.rerender(page(Component));
		await waitFor(() => expect(signal?.aborted).toBe(true));
		await screen.findByRole("link", { name: "Edit" });
		await act(async () =>
			pending.resolve(
				Response.json({ ok: true, inline: { ...DEPLOY_PIPELINE_SCENE, title: "STALE" } }),
			),
		);
		expect(screen.queryByText("STALE")).toBeNull();
		const unmountPending = Promise.withResolvers<Response>();
		let nextSignal: AbortSignal | undefined;
		fetcher.mockImplementationOnce(async (_url, init) => {
			nextSignal = init?.signal ?? undefined;
			return unmountPending.promise;
		});
		params.artifactId = "artifact_three";
		view.rerender(page(Component));
		await waitFor(() => expect(nextSignal).toBeTruthy());
		view.unmount();
		await waitFor(() => expect(nextSignal?.aborted).toBe(true));
	});
	it("settles synchronous Save failure/retry/success and isolates mutation results by artifact", async () => {
		fetcher
			.mockResolvedValueOnce(scene())
			.mockResolvedValueOnce(
				Response.json(
					{ ok: false, code: "storage_failed", message: "Save unavailable" },
					{ status: 500, headers: { "cache-control": "no-store" } },
				),
			)
			.mockResolvedValueOnce(Response.json(created));
		const Component = component(Review);
		const view = render(page(Component));
		await screen.findByRole("link", { name: "Edit" });
		fireEvent.click(screen.getByRole("button", { name: "Save to Studio" }));
		expect(await screen.findByText("Save unavailable")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save to Studio" })).toHaveProperty(
			"disabled",
			false,
		);
		fireEvent.click(screen.getByRole("button", { name: "Save to Studio" }));
		expect(await screen.findByRole("link", { name: "Open project" })).toHaveProperty(
			"href",
			window.location.origin + "/projects/proj_owner",
		);
		fetcher.mockResolvedValueOnce(scene());
		params.artifactId = "artifact_two";
		view.rerender(page(Component));
		await screen.findByRole("link", { name: "Edit" });
		expect(screen.queryByRole("link", { name: "Open project" })).toBeNull();
		expect(screen.getByRole("button", { name: "Save to Studio" })).toHaveProperty(
			"disabled",
			false,
		);
	});
});
