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
    hostname === "icons.sketchi.app" ||
    // sketchi-allow-workers-dev: PR Previews of the Icons Worker have no
    // custom domain, so handoff from a preview must keep working. Matched,
    // never rendered — production links use the public host above.
    /^(?:pr-\d+-)?sketchi-icons\.dimethyl\.workers\.dev$/.test(hostname) ||
    /^(?:[a-z0-9-]+\.)*icons\.sketchi\.localhost$/.test(hostname)
  );
}

function isAllowedIconPath(pathname: string): boolean {
  return /^\/output\/upload-ready\/svg\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\.svg$/i.test(
    pathname,
  );
}

export interface SvgHandoffSearch {
  readonly color?: string | undefined;
  readonly colorMode?: "monochrome" | "preserve" | undefined;
  readonly fillStyle?: NativeFillStyle | undefined;
  readonly roughness?: NativeRoughness | undefined;
  readonly svg?: string | undefined;
}

export function validateSvgHandoffSearch(
  search: Record<string, unknown>,
): SvgHandoffSearch {
  return {
    color:
      typeof search.color === "string" && /^#[0-9a-f]{6}$/i.test(search.color)
        ? search.color.toLowerCase()
        : undefined,
    colorMode: search.colorMode === "monochrome" ? "monochrome" : undefined,
    fillStyle: search.fillStyle === "hachure" ? "hachure" : undefined,
    roughness:
      search.roughness === 0 || search.roughness === "0"
        ? 0
        : search.roughness === 2 || search.roughness === "2"
          ? 2
          : undefined,
    svg: typeof search.svg === "string" ? search.svg : undefined,
  };
}

export function parseSvgHandoff(search: SvgHandoffSearch): SvgHandoffResult {
  if (!search.svg) {
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
  const color = search.color ?? "#1e1e1e";
  return {
    handoff: {
      options: {
        colorProfile: monochrome
          ? { color, kind: "monochrome" }
          : { kind: "preserve" },
        fillStyle: search.fillStyle ?? "solid",
        roughness: search.roughness ?? 1,
      },
      sourceUrl: source.href,
    },
    kind: "valid",
  };
}
