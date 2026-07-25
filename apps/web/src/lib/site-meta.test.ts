import { describe, expect, it } from "vitest";

import { OG_IMAGE, SITE_URL, siteSocialMeta } from "./site-meta";

describe("siteSocialMeta", () => {
  it("publishes a static 1200x630 raster as an absolute social image", () => {
    expect(OG_IMAGE).toMatchObject({
      url: `${SITE_URL}/media/sketchi-og-card.png`,
      width: "1200",
      height: "630",
      type: "image/png",
    });
    expect(OG_IMAGE.url).toMatch(/^https:\/\//);

    expect(siteSocialMeta()).toEqual(
      expect.arrayContaining([
        { property: "og:image", content: OG_IMAGE.url },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: OG_IMAGE.alt },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: OG_IMAGE.url },
        { name: "twitter:image:alt", content: OG_IMAGE.alt },
      ]),
    );
  });
});
