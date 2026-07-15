import { describe, expect, it } from "vitest";

import { DEFAULT_ICON_CONVERSION_CONTROLS } from "./icon-conversion";
import {
  buildWorkspaceUrl,
  workspaceOriginForIconsOrigin,
} from "./workspace-url";

describe("workspace URL handoff", () => {
  it("targets the matching Excalidraw preview Worker", () => {
    const href = buildWorkspaceUrl({
      controls: {
        ...DEFAULT_ICON_CONVERSION_CONTROLS,
        color: "#5f3dc4",
        colorMode: "monochrome",
        fillStyle: "hachure",
        roughness: 2,
      },
      iconsOrigin: "https://sketchi-icons-pr-91.dimethyl.workers.dev",
      svgPath: "/output/upload-ready/svg/auth-identity/workos.svg",
    });
    const url = new URL(href);

    expect(url.origin).toBe(
      "https://sketchi-excalidraw-pr-91.dimethyl.workers.dev",
    );
    expect(url.searchParams.get("svg")).toBe(
      "https://sketchi-icons-pr-91.dimethyl.workers.dev/output/upload-ready/svg/auth-identity/workos.svg",
    );
    expect(url.searchParams.get("roughness")).toBe("2");
    expect(url.searchParams.get("color")).toBe("#5f3dc4");
  });

  it("maps stable and local Icons origins without scene payloads", () => {
    expect(
      workspaceOriginForIconsOrigin(
        "https://sketchi-icons.dimethyl.workers.dev",
      ),
    ).toBe("https://sketchi-excalidraw.dimethyl.workers.dev");
    expect(
      workspaceOriginForIconsOrigin("https://icons.sketchi.localhost"),
    ).toBe("https://excalidraw.sketchi.localhost");
    expect(
      workspaceOriginForIconsOrigin(
        "https://svg-native-conversion-ui.icons.sketchi.localhost",
      ),
    ).toBe("https://svg-native-conversion-ui.excalidraw.sketchi.localhost");
  });
});
