import { describe, expect, it } from "vitest";

import type { SketchiIcon } from "./icon-data";
import {
  componentNameForIcon,
  svgDataUri,
  svgToJsxComponent,
} from "./icon-actions";

const icon: SketchiIcon = {
  aliases: [],
  bytes: 100,
  collection: "data-storage",
  keywords: [],
  name: "PostgreSQL",
  slug: "postgresql",
  svgPath: "/icons/postgresql.svg",
  viewBox: { height: 24, minX: 0, minY: 0, width: 24 },
};

describe("icon use formats", () => {
  it("creates a usable React component", () => {
    const jsx = svgToJsxComponent(
      '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" style="stroke-width:2" /></svg>',
      icon,
    );
    expect(componentNameForIcon(icon)).toBe("PostgreSQLIcon");
    expect(jsx).toContain('fillRule="evenodd"');
    expect(jsx).toContain('style={{ strokeWidth: "2" }}');
    expect(jsx).toContain("{...props}");
  });

  it("encodes a data URI", () => {
    expect(svgDataUri("<svg />")).toBe("data:image/svg+xml,%3Csvg%20%2F%3E");
  });
});
