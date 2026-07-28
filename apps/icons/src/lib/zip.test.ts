// @vitest-environment node

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { createIconZipBytes } from "./actions";

describe("icon zip downloads", () => {
  it("creates a valid archive containing every raw SVG", async () => {
    const bytes = await createIconZipBytes([
      { slug: "one", svg: "<svg>one</svg>" },
      { slug: "two", svg: "<svg>two</svg>" },
    ]);
    const archive = unzipSync(bytes);
    expect(Object.keys(archive)).toEqual(["one.svg", "two.svg"]);
    expect(new TextDecoder().decode(archive["one.svg"])).toBe("<svg>one</svg>");
    expect(new TextDecoder().decode(archive["two.svg"])).toBe("<svg>two</svg>");
  });
});
