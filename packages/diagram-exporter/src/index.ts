import {
  fetchJson as fetchJsonImplementation,
  shareElements as shareElementsImplementation,
} from "./lib/api.js";
import type {
  ExcalidrawFile as InternalExcalidrawFile,
  ExcalidrawSummary as InternalExcalidrawSummary,
} from "./lib/excalidraw.js";
import {
  extractShareLink as extractShareLinkImplementation,
  readExcalidrawFile as readExcalidrawFileImplementation,
  summarizeElements as summarizeElementsImplementation,
} from "./lib/excalidraw.js";
import type {
  DiagramPngExportDeps as InternalDiagramPngExportDeps,
  DiagramPngExportInput as InternalDiagramPngExportInput,
  DiagramPngExportResult as InternalDiagramPngExportResult,
} from "./lib/export-png.js";
import { exportDiagramToPng as exportDiagramToPngImplementation } from "./lib/export-png.js";
import {
  buildDefaultPngPath as buildDefaultPngPathImplementation,
  DEFAULT_OUTPUT_DIR as defaultOutputDirImplementation,
  resolveOutputPath as resolveOutputPathImplementation,
  resolveSessionPngOutputRoot as resolveSessionPngOutputRootImplementation,
  writePng as writePngImplementation,
} from "./lib/output.js";
import type { RenderOptions as InternalRenderOptions } from "./lib/render.js";
import {
  closeBrowser as closeBrowserImplementation,
  mapPlaywrightLaunchError as mapPlaywrightLaunchErrorImplementation,
  renderElementsToPng as renderElementsToPngImplementation,
} from "./lib/render.js";
import type { ResolveShareUrlDeps as InternalResolveShareUrlDeps } from "./lib/resolve-share-url.js";
import { resolveExcalidrawFromShareUrl as resolveExcalidrawFromShareUrlImplementation } from "./lib/resolve-share-url.js";

export const DEFAULT_OUTPUT_DIR = defaultOutputDirImplementation;
export const buildDefaultPngPath = buildDefaultPngPathImplementation;
export const closeBrowser = closeBrowserImplementation;
export const exportDiagramToPng = exportDiagramToPngImplementation;
export const extractShareLink = extractShareLinkImplementation;
export const fetchJson = fetchJsonImplementation;
export const mapPlaywrightLaunchError = mapPlaywrightLaunchErrorImplementation;
export const readExcalidrawFile = readExcalidrawFileImplementation;
export const renderElementsToPng = renderElementsToPngImplementation;
export const resolveExcalidrawFromShareUrl =
  resolveExcalidrawFromShareUrlImplementation;
export const resolveOutputPath = resolveOutputPathImplementation;
export const resolveSessionPngOutputRoot =
  resolveSessionPngOutputRootImplementation;
export const shareElements = shareElementsImplementation;
export const summarizeElements = summarizeElementsImplementation;
export const writePng = writePngImplementation;

export type DiagramPngExportDeps = InternalDiagramPngExportDeps;
export type DiagramPngExportInput = InternalDiagramPngExportInput;
export type DiagramPngExportResult = InternalDiagramPngExportResult;
export type ExcalidrawFile = InternalExcalidrawFile;
export type ExcalidrawSummary = InternalExcalidrawSummary;
export type RenderOptions = InternalRenderOptions;
export type ResolveShareUrlDeps = InternalResolveShareUrlDeps;
