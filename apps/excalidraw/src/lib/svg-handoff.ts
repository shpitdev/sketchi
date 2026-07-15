import type {
  NativeFillStyle,
  NativeRoughness,
  SvgToExcalidrawOptions,
} from "@sketchi/svg-excalidraw";

export interface SvgHandoff {
  readonly options: SvgToExcalidrawOptions;
  readonly sourceUrl: string;
}

export type SvgHandoffResult =
  | { readonly handoff: SvgHandoff; readonly kind: "valid" }
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly message: string };

function isAllowedIconHost(hostname: string): boolean {
  return (
    /^sketchi-icons(?:-pr-\d+)?\.dimethyl\.workers\.dev$/.test(hostname) ||
    hostname === "icons.sketchi.app" ||
    /^(?:[a-z0-9-]+\.)*icons\.sketchi\.localhost$/.test(hostname)
  );
}

function isAllowedIconPath(pathname: string): boolean {
  return /^\/output\/upload-ready\/svg\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\.svg$/i.test(
    pathname,
  );
}

function roughness(value: unknown): NativeRoughness {
  return value === "0" || value === 0
    ? 0
    : value === "2" || value === 2
      ? 2
      : 1;
}

function fillStyle(value: unknown): NativeFillStyle {
  return value === "hachure" ? "hachure" : "solid";
}

export interface SvgHandoffSearch {
  readonly color?: unknown;
  readonly colorMode?: unknown;
  readonly fillStyle?: unknown;
  readonly roughness?: unknown;
  readonly svg?: unknown;
}

export function parseSvgHandoff(search: SvgHandoffSearch): SvgHandoffResult {
  if (typeof search.svg !== "string" || search.svg.length === 0) {
    return { kind: "absent" };
  }
  let source: URL;
  try {
    source = new URL(search.svg);
  } catch {
    return { kind: "invalid", message: "The icon source URL is invalid." };
  }
  if (
    source.protocol !== "https:" ||
    !isAllowedIconHost(source.hostname) ||
    !isAllowedIconPath(source.pathname) ||
    source.username.length > 0 ||
    source.password.length > 0 ||
    source.port.length > 0 ||
    source.search.length > 0 ||
    source.hash.length > 0
  ) {
    return {
      kind: "invalid",
      message: "Workspace imports accept only public Sketchi icon SVG URLs.",
    };
  }
  const monochrome = search.colorMode === "monochrome";
  const color =
    typeof search.color === "string" && /^#[0-9a-f]{6}$/i.test(search.color)
      ? search.color.toLowerCase()
      : "#1e1e1e";
  return {
    handoff: {
      options: {
        colorProfile: monochrome
          ? { color, kind: "monochrome" }
          : { kind: "preserve" },
        fillStyle: fillStyle(search.fillStyle),
        roughness: roughness(search.roughness),
      },
      sourceUrl: source.href,
    },
    kind: "valid",
  };
}
