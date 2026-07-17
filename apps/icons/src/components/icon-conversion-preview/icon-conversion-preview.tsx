import { lazy, Suspense, useEffect, useState } from "react";

import type { SketchiIcon } from "../../lib/icon-data";
import type {
  IconColorMode,
  IconConversionControls,
  IconConversionResult,
} from "../../lib/icon-conversion";
import { buildWorkspaceUrl } from "../../lib/workspace-url";

export interface IconConversionPreviewProps {
  icon: SketchiIcon;
  iconsOrigin?: string;
  /** Injectable only for deterministic source-loading tests. */
  fetchSource?: typeof fetch;
  /** Deterministic Storybook/test source; production stays fetch-on-Native. */
  initialSource?: string;
  initialMode?: PreviewMode;
}

const ExcalidrawSceneCanvas = lazy(async () => {
  const [module] = await Promise.all([
    import("@sketchi/diagram-ui"),
    import("@sketchi/diagram-ui/styles.css"),
  ]);
  return { default: module.ExcalidrawSceneCanvas };
});

interface CompletedConversion {
  readonly controls: IconConversionControls;
  readonly fileName: string;
  readonly result: IconConversionResult;
  readonly source: string;
}

type LoadState =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly source: string };

export type PreviewMode = "native" | "original";

const DEFAULT_CONTROLS: IconConversionControls = {
  color: "#1e1e1e",
  colorMode: "preserve",
  fillStyle: "solid",
  roughness: 1,
};

function roughnessFromValue(value: string): 0 | 1 | 2 {
  return value === "0" ? 0 : value === "2" ? 2 : 1;
}

function colorModeFromValue(value: string): IconColorMode {
  return value === "monochrome" ? "monochrome" : "preserve";
}

export function IconConversionPreview({
  fetchSource = fetch,
  icon,
  iconsOrigin,
  initialMode = "original",
  initialSource,
}: IconConversionPreviewProps) {
  const [mode, setMode] = useState<PreviewMode>(initialMode);
  const [loadState, setLoadState] = useState<LoadState>(
    initialSource === undefined
      ? { kind: "idle" }
      : { kind: "ready", source: initialSource },
  );
  const [controls, setControls] =
    useState<IconConversionControls>(DEFAULT_CONTROLS);
  const [completed, setCompleted] = useState<CompletedConversion | null>(null);
  const converted =
    completed !== null &&
    completed.controls === controls &&
    completed.fileName === icon.fileName &&
    loadState.kind === "ready" &&
    completed.source === loadState.source
      ? completed.result
      : null;

  useEffect(() => {
    if (mode !== "native" || loadState.kind !== "ready") {
      return;
    }
    let active = true;
    setCompleted(null);
    const timer = window.setTimeout(() => {
      void import("../../lib/icon-conversion")
        .then((module) => {
          if (!active) return;
          setCompleted({
            controls,
            fileName: icon.fileName,
            result: module.convertIconSvg(
              loadState.source,
              icon.fileName,
              controls,
            ),
            source: loadState.source,
          });
        })
        .catch(() => {
          if (!active) return;
          setLoadState({
            kind: "error",
            message: "Native converter could not be loaded.",
          });
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [controls, icon.fileName, loadState, mode]);
  const nativeConversion =
    converted?.kind === "converted" ? converted.conversion : null;
  const nativeReady = nativeConversion?.ok === true;
  const status =
    converted?.kind === "parse-error" ? "blocked" : converted?.status;
  const diagnostics =
    converted?.kind === "parse-error"
      ? converted.diagnostics
      : (nativeConversion?.diagnostics ?? []);
  const workspaceHref = nativeReady
    ? buildWorkspaceUrl({
        controls,
        iconsOrigin:
          iconsOrigin ??
          (typeof window === "undefined"
            ? "https://sketchi-icons.dimethyl.workers.dev"
            : window.location.origin),
        svgPath: icon.urlPath,
      })
    : null;

  async function loadNativePreview() {
    setMode("native");
    if (loadState.kind === "ready" || loadState.kind === "loading") {
      return;
    }
    setLoadState({ kind: "loading" });
    try {
      const response = await fetchSource(icon.urlPath);
      if (!response.ok) {
        throw new Error(`Icon SVG returned HTTP ${response.status}.`);
      }
      setLoadState({ kind: "ready", source: await response.text() });
    } catch (error) {
      setLoadState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Native preview could not be loaded.",
      });
    }
  }

  async function downloadLibrary() {
    if (!nativeReady) {
      return;
    }
    const { downloadTextFile, iconLibraryJson } = await import(
      "../../lib/icon-conversion"
    );
    downloadTextFile(
      iconLibraryJson(nativeConversion, icon.slug),
      `${icon.slug}.excalidrawlib`,
      "application/vnd.excalidrawlib+json",
    );
  }

  return (
    <section className="icon-conversion" aria-label="Icon conversion preview">
      <div className="icon-conversion__tabs" role="tablist">
        <button
          aria-selected={mode === "original"}
          onClick={() => setMode("original")}
          role="tab"
          type="button"
        >
          Original
        </button>
        <button
          aria-selected={mode === "native"}
          onClick={loadNativePreview}
          role="tab"
          type="button"
        >
          Native
        </button>
        <span
          className="icon-conversion__capability"
          data-status={status ?? "unchecked"}
        >
          {status === "supported"
            ? "Native supported"
            : status === "warned"
              ? "Native with warnings"
              : status === "blocked"
                ? "Native blocked"
                : "Not checked"}
        </span>
      </div>

      <div className="icon-conversion__stage" role="tabpanel">
        {mode === "original" ? (
          <img
            alt={`${icon.slug} original SVG preview`}
            loading="lazy"
            src={icon.urlPath}
          />
        ) : loadState.kind === "idle" || loadState.kind === "loading" ? (
          <div className="icon-conversion__state" role="status">
            <span className="sketchi-icons__spin" aria-hidden="true" />
            Loading source SVG…
          </div>
        ) : loadState.kind === "error" ? (
          <div className="icon-conversion__state" role="alert">
            <span>{loadState.message}</span>
            <button onClick={loadNativePreview} type="button">
              Retry native preview
            </button>
          </div>
        ) : converted === null ? (
          <div className="icon-conversion__state" role="status">
            <span className="sketchi-icons__spin" aria-hidden="true" />
            Converting native elements…
          </div>
        ) : nativeReady ? (
          <Suspense
            fallback={
              <div className="icon-conversion__state" role="status">
                Loading editor preview…
              </div>
            }
          >
            <ExcalidrawSceneCanvas
              revision={`${nativeConversion.sourceHash}:${JSON.stringify(controls)}`}
              scene={{
                appState: { viewBackgroundColor: "#ffffff" },
                elements: nativeConversion.elements,
              }}
              title={`${icon.slug} native preview`}
              viewModeEnabled
            />
          </Suspense>
        ) : (
          <div className="icon-conversion__state" role="status">
            Native conversion is unavailable for this SVG.
          </div>
        )}
      </div>

      {mode === "native" && loadState.kind === "ready" ? (
        <>
          <div
            className="icon-conversion__controls"
            aria-label="Native controls"
          >
            <label>
              Roughness
              <select
                aria-label="Roughness"
                onChange={(event) => {
                  const roughness = roughnessFromValue(
                    event.currentTarget.value,
                  );
                  setControls((current) => ({ ...current, roughness }));
                }}
                value={controls.roughness}
              >
                <option value="0">0 · precise</option>
                <option value="1">1 · sketched</option>
                <option value="2">2 · rough</option>
              </select>
            </label>
            <label>
              Fill
              <select
                aria-label="Fill style"
                onChange={(event) => {
                  const fillStyle =
                    event.currentTarget.value === "hachure"
                      ? "hachure"
                      : "solid";
                  setControls((current) => ({ ...current, fillStyle }));
                }}
                value={controls.fillStyle}
              >
                <option value="solid">Solid</option>
                <option value="hachure">Hachure</option>
              </select>
            </label>
            <label>
              Color
              <select
                aria-label="Color mode"
                onChange={(event) => {
                  const colorMode = colorModeFromValue(
                    event.currentTarget.value,
                  );
                  setControls((current) => ({ ...current, colorMode }));
                }}
                value={controls.colorMode}
              >
                <option value="preserve">Preserve source</option>
                <option value="monochrome">Monochrome</option>
              </select>
            </label>
            {controls.colorMode === "monochrome" ? (
              <label className="icon-conversion__color">
                Ink
                <input
                  aria-label="Monochrome color"
                  onChange={(event) => {
                    const color = event.currentTarget.value;
                    setControls((current) => ({ ...current, color }));
                  }}
                  type="color"
                  value={controls.color}
                />
              </label>
            ) : null}
          </div>

          {nativeReady ? (
            <div className="icon-conversion__metrics">
              <span>{nativeConversion.metrics.elements} elements</span>
              <span>{nativeConversion.metrics.points} points</span>
            </div>
          ) : null}

          {diagnostics.length > 0 ? (
            <ul
              className="icon-conversion__diagnostics"
              aria-label="Conversion diagnostics"
            >
              {diagnostics.slice(0, 4).map((diagnostic, index) => (
                <li key={`${diagnostic.code}:${index}`}>
                  <strong>{diagnostic.severity}</strong> {diagnostic.message}
                </li>
              ))}
              {diagnostics.length > 4 ? (
                <li>{diagnostics.length - 4} more diagnostics</li>
              ) : null}
            </ul>
          ) : null}

          <div className="icon-conversion__actions">
            <button
              disabled={!nativeReady}
              onClick={downloadLibrary}
              type="button"
            >
              Download library
            </button>
            {workspaceHref ? (
              <a href={workspaceHref}>Open in Workspace</a>
            ) : (
              <span aria-disabled="true">Open in Workspace</span>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
