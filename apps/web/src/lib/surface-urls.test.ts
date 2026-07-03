import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_SURFACE_URLS,
  resolveWebSurfaceUrls,
  surfaceLinkLabel,
} from "./surface-urls";

describe("resolveWebSurfaceUrls", () => {
  it("uses production worker URLs by default", () => {
    expect(resolveWebSurfaceUrls()).toEqual(DEFAULT_WEB_SURFACE_URLS);
    expect(DEFAULT_WEB_SURFACE_URLS.excalidraw).toBe(
      "https://sketchi-excalidraw.dimethyl.workers.dev",
    );
  });

  it("uses configured preview URLs", () => {
    expect(
      resolveWebSurfaceUrls({
        SKETCHI_EXCALIDRAW_URL:
          "https://sketchi-excalidraw-pr-42.dimethyl.workers.dev/",
        SKETCHI_ICONS_URL: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
        SKETCHI_PLAYGROUND_URL:
          "https://sketchi-playground-pr-42.dimethyl.workers.dev",
      }),
    ).toEqual({
      excalidraw: "https://sketchi-excalidraw-pr-42.dimethyl.workers.dev",
      icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
      playground: "https://sketchi-playground-pr-42.dimethyl.workers.dev",
    });
  });

  it("falls back when configured URLs are not http urls", () => {
    expect(
      resolveWebSurfaceUrls({
        SKETCHI_EXCALIDRAW_URL: "javascript:alert(1)",
      }).excalidraw,
    ).toBe(DEFAULT_WEB_SURFACE_URLS.excalidraw);
  });
});

describe("surfaceLinkLabel", () => {
  it("uses the hostname for absolute links", () => {
    expect(
      surfaceLinkLabel(
        "https://sketchi-excalidraw-pr-42.dimethyl.workers.dev",
        "fallback",
      ),
    ).toBe("sketchi-excalidraw-pr-42.dimethyl.workers.dev");
  });

  it("uses the fallback for relative links", () => {
    expect(surfaceLinkLabel("/docs", "sketchi.app/docs")).toBe(
      "sketchi.app/docs",
    );
  });
});
