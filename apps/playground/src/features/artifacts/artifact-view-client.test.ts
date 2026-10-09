import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArtifactReview } from "./artifact-view-client";
import { DEPLOY_PIPELINE_SCENE } from "../playground/deploy-pipeline-sample";

afterEach(() => vi.unstubAllGlobals());
describe("artifact review fetch", () => {
  it("reports HTTP failures without parsing an error page", async () => {
    const json = vi.fn().mockRejectedValue(new SyntaxError("Unexpected token"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json }));
    await expect(fetchArtifactReview("missing")).rejects.toThrow(
      "Artifact could not be loaded.",
    );
    expect(json).not.toHaveBeenCalled();
  });
  it("reports invalid JSON with a friendly message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect(fetchArtifactReview("broken")).rejects.toThrow(
      "Artifact could not be loaded.",
    );
  });
  it("forwards cancellation to the artifact fetch", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ ok: true, inline: DEPLOY_PIPELINE_SCENE }),
      );
    vi.stubGlobal("fetch", fetcher);
    await fetchArtifactReview("valid", signal);
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), { signal });
  });
  it("still loads a valid scene", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ok: true, inline: DEPLOY_PIPELINE_SCENE }),
        ),
    );
    expect((await fetchArtifactReview("valid")).scene).toEqual(
      DEPLOY_PIPELINE_SCENE,
    );
  });
});
