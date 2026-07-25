import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  ExcalidrawSceneCanvas,
  type ExcalidrawSceneCanvasProps,
} from "@sketchi/diagram-ui";
import {
  convertSvgToExcalidraw,
  parseSvg,
  serializeExcalidrawLibrary,
  type SvgDiagnostic,
  type SvgToExcalidrawResult,
} from "@sketchi/svg-excalidraw";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SvgHandoff } from "../../lib/svg-handoff";
import { WorkspaceTopBar } from "../workspace-top-bar/index.js";

export interface SvgIconWorkspaceProps {
  handoff: SvgHandoff;
  onEditorApi?: ExcalidrawSceneCanvasProps["onApiChange"];
  /** Deterministic Storybook/test source; production fetches the handoff URL. */
  initialSource?: string;
}

const MAX_SVG_BYTES = 1_000_000;

type ImportState =
  | {
      readonly diagnostics: readonly SvgDiagnostic[];
      readonly kind: "parse-error";
    }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "loading" }
  | {
      readonly conversion: SvgToExcalidrawResult;
      readonly kind: "converted";
    }
  | {
      readonly kind: "source";
      readonly source: string;
      readonly sourceUrl: string;
    };

function sourceName(sourceUrl: string): string {
  const fileName = new URL(sourceUrl).pathname.split("/").at(-1);
  return fileName ?? "icon.svg";
}

async function readSvgResponse(response: Response): Promise<string> {
  if (!response.ok) {
    throw new Error(`Icon SVG returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("image/svg+xml")) {
    throw new Error("Icon source did not return an SVG content type.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SVG_BYTES) {
    throw new Error("Icon SVG exceeds the 1 MB workspace import limit.");
  }
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > MAX_SVG_BYTES) {
    throw new Error("Icon SVG exceeds the 1 MB workspace import limit.");
  }
  return source;
}

function convertSource(source: string, handoff: SvgHandoff): ImportState {
  const parsed = parseSvg(source, {
    sourceName: sourceName(handoff.sourceUrl),
  });
  if (!parsed.ok) {
    return { diagnostics: parsed.diagnostics, kind: "parse-error" };
  }
  return {
    conversion: convertSvgToExcalidraw(parsed.document, handoff.options),
    kind: "converted",
  };
}

function saveLibrary(
  elements: readonly ExcalidrawElement[],
  sourceHash: string,
  name: string,
) {
  const contents = serializeExcalidrawLibrary([
    {
      elements,
      id: `svg:${sourceHash}`,
      name,
    },
  ]);
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/vnd.excalidrawlib+json" }),
  );
  const anchor = document.createElement("a");
  anchor.download = `${name.replace(/\.svg$/i, "")}.excalidrawlib`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function SvgIconWorkspace({
  handoff,
  initialSource,
  onEditorApi,
}: SvgIconWorkspaceProps) {
  const [importState, setImportState] = useState<ImportState>(
    initialSource === undefined
      ? { kind: "loading" }
      : {
          kind: "source",
          source: initialSource,
          sourceUrl: handoff.sourceUrl,
        },
  );
  const [editedScene, setEditedScene] = useState<{
    readonly elements: readonly ExcalidrawElement[];
    readonly revision: string;
  } | null>(null);

  useEffect(() => {
    if (initialSource !== undefined) {
      return;
    }
    let active = true;
    setImportState({ kind: "loading" });
    fetch(handoff.sourceUrl, { redirect: "error" })
      .then(readSvgResponse)
      .then((source) => {
        if (active) {
          setImportState({
            kind: "source",
            source,
            sourceUrl: handoff.sourceUrl,
          });
        }
      })
      .catch((error) => {
        if (active) {
          setImportState({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "The icon SVG could not be loaded.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [handoff.sourceUrl, initialSource]);

  const resolved = useMemo(
    () =>
      importState.kind === "source" &&
      importState.sourceUrl === handoff.sourceUrl
        ? convertSource(importState.source, handoff)
        : importState.kind === "source"
          ? { kind: "loading" as const }
          : importState,
    [handoff, importState],
  );
  const conversion = resolved.kind === "converted" ? resolved.conversion : null;
  const ready = conversion?.ok === true;
  const diagnostics =
    resolved.kind === "parse-error"
      ? resolved.diagnostics
      : (conversion?.diagnostics ?? []);
  const name = sourceName(handoff.sourceUrl);
  const revision = ready
    ? `${conversion.sourceHash}:${JSON.stringify(conversion.options)}`
    : "unavailable";
  const currentElements =
    ready && editedScene?.revision === revision
      ? editedScene.elements
      : ready
        ? conversion.elements
        : [];
  const handleSceneChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      const activeElements = elements.some((element) => element.isDeleted)
        ? elements.filter((element) => !element.isDeleted)
        : elements;
      setEditedScene((current) =>
        current?.revision === revision && current.elements === activeElements
          ? current
          : { elements: activeElements, revision },
      );
    },
    [revision],
  );
  const workspaceStatus =
    resolved.kind === "loading" ? "loading" : ready ? "ready" : "error";

  return (
    <main className="svg-icon-workspace">
      <WorkspaceTopBar
        actions={
          <>
            <a
              className="workspace-action"
              href={handoff.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              Source SVG
            </a>
            <button
              className="workspace-action workspace-action--primary"
              disabled={!ready}
              onClick={() => {
                if (ready) {
                  saveLibrary(currentElements, conversion.sourceHash, name);
                }
              }}
              type="button"
            >
              Download library
            </button>
          </>
        }
        diagramType="native icon"
        status={workspaceStatus}
        title={name}
      />

      <div className="svg-icon-workspace__body">
        <aside className="svg-icon-workspace__sidebar">
          <h1>Editable native elements</h1>
          <p>
            Reload-safe URL import from the public Sketchi icon corpus. The
            source is reconverted locally; no scene payload or hosted backend is
            involved.
          </p>
          <dl>
            <div>
              <dt>Roughness</dt>
              <dd>{handoff.options.roughness ?? 1}</dd>
            </div>
            <div>
              <dt>Fill</dt>
              <dd>{handoff.options.fillStyle ?? "solid"}</dd>
            </div>
            <div>
              <dt>Color</dt>
              <dd>
                {handoff.options.colorProfile?.kind === "monochrome"
                  ? handoff.options.colorProfile.color
                  : "Source"}
              </dd>
            </div>
            {ready ? (
              <>
                <div>
                  <dt>Elements</dt>
                  <dd>{conversion.metrics.elements}</dd>
                </div>
                <div>
                  <dt>Points</dt>
                  <dd>{conversion.metrics.points}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {diagnostics.length > 0 ? (
            <ul aria-label="Import diagnostics">
              {diagnostics.slice(0, 8).map((diagnostic, index) => (
                <li key={`${diagnostic.code}:${index}`}>
                  <strong>{diagnostic.severity}</strong> {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        <section
          className="svg-icon-workspace__canvas"
          aria-label="Icon workspace canvas"
        >
          {resolved.kind === "loading" ? (
            <div className="workspace-state" role="status">
              Loading source SVG…
            </div>
          ) : ready ? (
            <ExcalidrawSceneCanvas
              {...(onEditorApi ? { onApiChange: onEditorApi } : {})}
              onChange={handleSceneChange}
              revision={revision}
              scene={{
                appState: { viewBackgroundColor: "#ffffff" },
                elements: conversion.elements,
              }}
              title={`${name} editable canvas`}
              viewModeEnabled={false}
              zenModeEnabled={false}
            />
          ) : (
            <div className="workspace-state" role="alert">
              <h2 className="workspace-state__title">
                Native import unavailable
              </h2>
              <p className="workspace-state__body">
                {resolved.kind === "error"
                  ? resolved.message
                  : "This SVG uses semantics that cannot be preserved as native Excalidraw elements."}
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
