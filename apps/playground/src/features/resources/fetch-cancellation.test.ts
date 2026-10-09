import {
  fetchStudioDiagramDetails,
  fetchStudioProjectDetails,
  fetchStudioProjects,
} from "@sketchi/studio-projects/client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
describe("Studio resource cancellation", () => {
  it.each([
    {
      load: (signal: AbortSignal) => fetchStudioProjects(signal),
      url: "/api/studio/projects",
    },
    {
      load: (signal: AbortSignal) =>
        fetchStudioProjectDetails("project", signal),
      url: "/api/studio/projects/project",
    },
    {
      load: (signal: AbortSignal) =>
        fetchStudioDiagramDetails("diagram", signal),
      url: "/api/studio/diagrams/diagram",
    },
  ])("passes the resource signal to $url", async ({ load, url }) => {
    const controller = new AbortController();
    const cancelled = new DOMException("Cancelled", "AbortError");
    const fetcher = vi.fn().mockRejectedValue(cancelled);
    vi.stubGlobal("fetch", fetcher);
    await expect(load(controller.signal)).rejects.toBe(cancelled);
    expect(fetcher).toHaveBeenCalledWith(url, { signal: controller.signal });
  });
});
