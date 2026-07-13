import type { IconConversionControls } from "./icon-conversion";

const DEFAULT_WORKSPACE_ORIGIN =
  "https://sketchi-excalidraw.dimethyl.workers.dev";

export function workspaceOriginForIconsOrigin(iconsOrigin: string): string {
  const origin = new URL(iconsOrigin);
  const workersMatch = origin.hostname.match(
    /^sketchi-icons(?<preview>-pr-\d+)?(?<suffix>\.[a-z0-9-]+\.workers\.dev)$/,
  );
  if (workersMatch?.groups) {
    return `${origin.protocol}//sketchi-excalidraw${workersMatch.groups.preview ?? ""}${workersMatch.groups.suffix}`;
  }
  if (origin.hostname === "icons.sketchi.app") {
    return "https://excalidraw.sketchi.app";
  }
  const localMatch = origin.hostname.match(
    /^(?<prefix>(?:[a-z0-9-]+\.)*)icons\.sketchi\.localhost$/,
  );
  if (localMatch?.groups) {
    return `${origin.protocol}//${localMatch.groups.prefix}excalidraw.sketchi.localhost`;
  }
  if (origin.hostname === "localhost" || origin.hostname === "127.0.0.1") {
    return "https://excalidraw.sketchi.localhost";
  }
  return DEFAULT_WORKSPACE_ORIGIN;
}

export function buildWorkspaceUrl(input: {
  readonly controls: IconConversionControls;
  readonly iconsOrigin: string;
  readonly svgPath: string;
}): string {
  const sourceUrl = new URL(input.svgPath, input.iconsOrigin);
  const workspaceUrl = new URL(
    "/",
    workspaceOriginForIconsOrigin(input.iconsOrigin),
  );
  workspaceUrl.searchParams.set("svg", sourceUrl.href);
  workspaceUrl.searchParams.set("roughness", String(input.controls.roughness));
  workspaceUrl.searchParams.set("fillStyle", input.controls.fillStyle);
  workspaceUrl.searchParams.set("colorMode", input.controls.colorMode);
  if (input.controls.colorMode === "monochrome") {
    workspaceUrl.searchParams.set("color", input.controls.color);
  }
  return workspaceUrl.href;
}
