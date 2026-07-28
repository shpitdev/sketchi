import "@tanstack/react-start/server-only";

import {
  applyDiagramPatch,
  buildFlowchart,
  buildMindmap,
  buildSequenceDiagram,
  CodeModeArtifactStorage,
  CodeModeRuntimeEnvironment,
  getArtifact,
  makeMemoryArtifactStorage,
  makeObjectBucketArtifactStorage,
  type ApplyDiagramPatchResult,
  type ArtifactFormat,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type BuildSequenceDiagramResult,
  type CodeModeArtifactStorageError,
  type CodeModeArtifactStorageShape,
  type CodeModeRuntimeOptions,
  type GetArtifactResult,
  type StoredArtifactFormat,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import {
  PlaygroundBindings,
  PlaygroundIds,
  PlaygroundRequestMetadata,
} from "../runtime/context.server";
import {
  DEFAULT_ASSET_ORIGIN,
  PlaygroundBrowserRendering,
  PlaygroundBrowserRenderingLive,
  type CloudflareBrowserRunRendererOptions,
} from "./browser-renderer.server";

type CodeModeRequestContext =
  | PlaygroundBindings
  | PlaygroundIds
  | PlaygroundRequestMetadata;

export interface PlaygroundCodeModeShape {
  readonly applyDiagramPatch: (
    input: unknown,
  ) => Effect.Effect<ApplyDiagramPatchResult, never, CodeModeRequestContext>;
  readonly buildFlowchart: (
    input: unknown,
  ) => Effect.Effect<BuildFlowchartResult, never, CodeModeRequestContext>;
  readonly buildMindmap: (
    input: unknown,
  ) => Effect.Effect<BuildMindmapResult, never, CodeModeRequestContext>;
  readonly buildSequenceDiagram: (
    input: unknown,
  ) => Effect.Effect<BuildSequenceDiagramResult, never, CodeModeRequestContext>;
  readonly getArtifact: (
    input: unknown,
  ) => Effect.Effect<GetArtifactResult, never, CodeModeRequestContext>;
  readonly readStoredArtifact: (
    artifactId: string,
    format: ArtifactFormat,
  ) => Effect.Effect<
    StoredArtifactFormat | null,
    CodeModeArtifactStorageError,
    PlaygroundBindings
  >;
}

export class PlaygroundCodeMode extends Context.Service<
  PlaygroundCodeMode,
  PlaygroundCodeModeShape
>()("@sketchi/playground/PlaygroundCodeMode") {}

const PlaygroundLocalArtifactStorageLive = Layer.effect(
  CodeModeArtifactStorage,
  Effect.sync(makeMemoryArtifactStorage),
);

function artifactStoreForBindings(
  env: Context.Service.Shape<typeof PlaygroundBindings>,
  localStorage: CodeModeArtifactStorageShape,
): CodeModeArtifactStorageShape {
  return env.SKETCHI_ARTIFACTS
    ? makeObjectBucketArtifactStorage(env.SKETCHI_ARTIFACTS, {
        prefix: "codemode",
      })
    : localStorage;
}

function artifactUrl(
  origin: string,
  input: { artifactId: string; format: ArtifactFormat },
): string {
  const url = new URL(
    `/api/v1/artifacts/${encodeURIComponent(input.artifactId)}`,
    origin,
  );
  url.searchParams.set("format", input.format);
  url.searchParams.set("raw", "true");
  return url.toString();
}

function rendererOptions(
  env: Context.Service.Shape<typeof PlaygroundBindings>,
  origin: string,
): CloudflareBrowserRunRendererOptions {
  if (env.SKETCHI_RENDER_ASSET_ORIGIN) {
    return { assetOrigin: env.SKETCHI_RENDER_ASSET_ORIGIN };
  }
  if (!isLocalOrigin(origin)) {
    return { assetOrigin: origin };
  }
  return { assetOrigin: DEFAULT_ASSET_ORIGIN };
}

function isLocalOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export const PlaygroundCodeModeLive = Layer.effect(
  PlaygroundCodeMode,
  Effect.gen(function* () {
    const browserRendering = yield* PlaygroundBrowserRendering;
    const localStorage = yield* CodeModeArtifactStorage;

    const provideRequestCodeMode = Effect.fn(
      "playground.codeMode.provideRequestServices",
    )(function* <A>(
      workflow: Effect.Effect<
        A,
        never,
        CodeModeArtifactStorage | CodeModeRuntimeEnvironment
      >,
    ) {
      const env = yield* PlaygroundBindings;
      const ids = yield* PlaygroundIds;
      const metadata = yield* PlaygroundRequestMetadata;
      const storage = artifactStoreForBindings(env, localStorage);
      const runtimeEnvironment: Context.Service.Shape<
        typeof CodeModeRuntimeEnvironment
      > = {
        createId: ids.create,
        artifactUrl: (input) => artifactUrl(metadata.origin, input),
        ...(env.BROWSER
          ? {
              renderer: browserRendering.renderer(
                env.BROWSER,
                rendererOptions(env, metadata.origin),
              ),
            }
          : {}),
      } satisfies CodeModeRuntimeOptions;

      return yield* workflow.pipe(
        Effect.provideService(CodeModeArtifactStorage, storage),
        Effect.provideService(CodeModeRuntimeEnvironment, runtimeEnvironment),
      );
    });

    return PlaygroundCodeMode.of({
      applyDiagramPatch: Effect.fn("playground.codeMode.applyDiagramPatch")(
        (input) => provideRequestCodeMode(applyDiagramPatch(input)),
      ),
      buildFlowchart: Effect.fn("playground.codeMode.buildFlowchart")((input) =>
        provideRequestCodeMode(buildFlowchart(input)),
      ),
      buildMindmap: Effect.fn("playground.codeMode.buildMindmap")((input) =>
        provideRequestCodeMode(buildMindmap(input)),
      ),
      buildSequenceDiagram: Effect.fn(
        "playground.codeMode.buildSequenceDiagram",
      )((input) => provideRequestCodeMode(buildSequenceDiagram(input))),
      getArtifact: Effect.fn("playground.codeMode.getArtifact")((input) =>
        provideRequestCodeMode(getArtifact(input)),
      ),
      readStoredArtifact: Effect.fn("playground.codeMode.readStoredArtifact")(
        function* (artifactId, format) {
          const env = yield* PlaygroundBindings;
          return yield* artifactStoreForBindings(env, localStorage).read(
            artifactId,
            format,
          );
        },
      ),
    });
  }),
).pipe(
  Layer.provideMerge(
    Layer.merge(
      PlaygroundBrowserRenderingLive,
      PlaygroundLocalArtifactStorageLive,
    ),
  ),
);
