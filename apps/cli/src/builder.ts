import {
  CodeModeArtifactStorage,
  CodeModeRuntimeEnvironment,
  buildFlowchart,
  buildMindmap,
  buildSequenceDiagram,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type BuildSequenceDiagramResult,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import {
  codeModeFailure,
  decodeInlineArtifacts,
  withCodeMode,
} from "./code-mode-artifacts.js";
import type { BuiltDiagram } from "./contracts.js";
import {
  documentId,
  type CanonicalDiagramDocument,
  validateStorageId,
} from "./document.js";
import {
  CliBuildError,
  CliStorageError,
  CliValidationError,
} from "./errors.js";

type BuildResult =
  BuildFlowchartResult | BuildMindmapResult | BuildSequenceDiagramResult;

export class DiagramBuilder extends Context.Service<
  DiagramBuilder,
  {
    readonly build: (
      document: CanonicalDiagramDocument,
    ) => Effect.Effect<
      BuiltDiagram,
      CliBuildError | CliStorageError | CliValidationError
    >;
  }
>()("@sketchi/cli/DiagramBuilder") {}

export const DiagramBuilderLive = Layer.effect(
  DiagramBuilder,
  Effect.gen(function* () {
    const artifactStorage = yield* CodeModeArtifactStorage;
    const environment = yield* CodeModeRuntimeEnvironment;

    const build = Effect.fn("sketchi.cli.diagram.build")(function* (
      document: CanonicalDiagramDocument,
    ) {
      const result: BuildResult = yield* withCodeMode(
        artifactStorage,
        environment,
        (
          options,
        ): Effect.Effect<
          BuildResult,
          never,
          CodeModeArtifactStorage | CodeModeRuntimeEnvironment
        > => {
          if (document.type === "flowchart")
            return buildFlowchart({ spec: document.spec, options });
          if (document.type === "mindmap")
            return buildMindmap({ spec: document.spec, options });
          return buildSequenceDiagram({ spec: document.spec, options });
        },
      );
      if (!result.ok) return yield* codeModeFailure(result, "build");
      const id = yield* validateStorageId(documentId(document));
      const { scene, excalidraw } = yield* decodeInlineArtifacts(
        result.artifact,
        "build",
      );
      return {
        id,
        type: document.type,
        title: document.spec.title,
        document,
        scene,
        excalidraw,
      } satisfies BuiltDiagram;
    });

    return { build };
  }),
);
