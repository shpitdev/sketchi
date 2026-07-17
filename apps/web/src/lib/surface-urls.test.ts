import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_SURFACE_URLS,
  LOCAL_WEB_SURFACE_URLS,
  PRODUCT_SURFACE_HOSTS,
  resolveWebSurfaceUrls,
  surfaceLinkLabel,
} from "./surface-urls";

describe("resolveWebSurfaceUrls", () => {
  it("uses production worker URLs by default", () => {
    expect(resolveWebSurfaceUrls()).toEqual(DEFAULT_WEB_SURFACE_URLS);
    expect(DEFAULT_WEB_SURFACE_URLS.playground).toBe(
      "https://sketchi-studio.dimethyl.workers.dev",
    );
  });

  it("centralizes future custom domains and local app URLs", () => {
    expect(PRODUCT_SURFACE_HOSTS).toEqual({
      docs: "sketchi.app/docs",
      icons: "icons.sketchi.app",
      playground: "playground.sketchi.app",
    });
    expect(LOCAL_WEB_SURFACE_URLS).toEqual({
      icons: "http://localhost:6203",
      playground: "http://localhost:6310",
    });
  });

  it("uses configured preview URLs", () => {
    expect(
      resolveWebSurfaceUrls({
        SKETCHI_ICONS_URL: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
        SKETCHI_PLAYGROUND_URL:
          "https://sketchi-studio-pr-42.dimethyl.workers.dev/",
      }),
    ).toEqual({
      icons: "https://sketchi-icons-pr-42.dimethyl.workers.dev",
      playground: "https://sketchi-studio-pr-42.dimethyl.workers.dev",
    });
  });

  it("falls back when configured URLs are not http urls", () => {
    expect(
      resolveWebSurfaceUrls({
        SKETCHI_PLAYGROUND_URL: "javascript:alert(1)",
      }).playground,
    ).toBe(DEFAULT_WEB_SURFACE_URLS.playground);
  });
});

describe("surfaceLinkLabel", () => {
  it("uses the hostname for absolute links", () => {
    expect(
      surfaceLinkLabel(
        "https://sketchi-studio-pr-42.dimethyl.workers.dev",
        "fallback",
      ),
    ).toBe("sketchi-studio-pr-42.dimethyl.workers.dev");
  });

  it("uses the fallback for relative links", () => {
    expect(surfaceLinkLabel("/docs", "sketchi.app/docs")).toBe(
      "sketchi.app/docs",
    );
  });
});
