import {
  CodeModeArtifactStorage,
  CodeModeRuntimeEnvironment,
  ExcalidrawFileSchema,
  RenderedDiagramSceneSchema,
  buildFlowchart,
  buildMindmap,
  buildSequenceDiagram,
  type BuildFlowchartResult,
  type BuildMindmapResult,
  type BuildSequenceDiagramResult,
  type CodeModeIssue,
  type ExcalidrawFile,
  type PatchableScene,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import type { BuiltDiagram, DiagramFormat } from "./contracts.js";
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
  | BuildFlowchartResult
  | BuildMindmapResult
  | BuildSequenceDiagramResult;
type BuiltArtifact = Extract<BuildResult, { readonly ok: true }>["artifact"];

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

function issueDetail(issue: CodeModeIssue): string {
  const path = issue.ref?.path ? ` (${issue.ref.path})` : "";
  return `${issue.code}${path}: ${issue.message}`;
}

function failureFromBuild(
  result: Extract<BuildResult, { ok: false }>,
): CliBuildError | CliStorageError | CliValidationError {
  const first = result.issues[0];
  const message = first?.message ?? `Code Mode failed with ${result.status}.`;
  const hint = first?.hint ?? "Repair the document and retry.";
  const details = result.issues.map(issueDetail);
  if (
    result.status === "invalid_input" ||
    result.status === "invalid_flowchart" ||
    result.status === "invalid_mindmap" ||
    result.status === "invalid_sequence" ||
    result.status === "quality_failed"
  ) {
    return CliValidationError.make({ message, hint, details });
  }
  if (result.status === "storage_failed") {
    return CliStorageError.make({
      code: "storage_commit_failed",
      message,
      hint,
    });
  }
  return CliBuildError.make({
    status: result.status,
    message,
    hint,
    details,
  });
}

function inlineArtifact(
  artifact: BuiltArtifact,
  format: Exclude<DiagramFormat, "png">,
): Effect.Effect<unknown, CliBuildError> {
  const ref = artifact.formats.find((candidate) => candidate.format === format);
  if (ref?.inline !== undefined) return Effect.succeed(ref.inline);
  return Effect.fail(
    CliBuildError.make({
      status: "missing_inline_artifact",
      message: `Code Mode did not return the ${format} artifact inline.`,
      hint: "Rebuild the document with the required offline artifact formats.",
      details: [format],
    }),
  );
}

function decodeScene(
  value: unknown,
): Effect.Effect<PatchableScene, CliBuildError> {
  const decoded = RenderedDiagramSceneSchema.safeParse(value);
  if (decoded.success) return Effect.succeed(decoded.data);
  return Effect.fail(
    CliBuildError.make({
      status: "invalid_scene_artifact",
      message: "Code Mode returned an invalid scene artifact.",
      hint: "Inspect the Code Mode build/export boundary.",
      details: decoded.error.issues.map((issue) => issue.message),
    }),
  );
}

function decodeExcalidraw(
  value: unknown,
): Effect.Effect<ExcalidrawFile, CliBuildError> {
  const decoded = ExcalidrawFileSchema.safeParse(value);
  if (decoded.success) return Effect.succeed(decoded.data);
  return Effect.fail(
    CliBuildError.make({
      status: "invalid_excalidraw_artifact",
      message: "Code Mode returned an invalid Excalidraw artifact.",
      hint: "Inspect the Code Mode build/export boundary.",
      details: decoded.error.issues.map((issue) => issue.message),
    }),
  );
}

export const DiagramBuilderLive = Layer.effect(
  DiagramBuilder,
  Effect.gen(function* () {
    const artifactStorage = yield* CodeModeArtifactStorage;
    const environment = yield* CodeModeRuntimeEnvironment;

    const build = Effect.fn("sketchi.cli.diagram.build")(function* (
      document: CanonicalDiagramDocument,
    ) {
      let result: BuildResult;
      if (document.type === "flowchart") {
        result = yield* buildFlowchart({
          spec: document.spec,
          options: {
            artifactFormats: ["scene", "excalidraw"],
            inlineArtifacts: ["scene", "excalidraw"],
          },
        }).pipe(
          Effect.provideService(CodeModeArtifactStorage, artifactStorage),
          Effect.provideService(CodeModeRuntimeEnvironment, environment),
        );
      } else if (document.type === "mindmap") {
        result = yield* buildMindmap({
          spec: document.spec,
          options: {
            artifactFormats: ["scene", "excalidraw"],
            inlineArtifacts: ["scene", "excalidraw"],
          },
        }).pipe(
          Effect.provideService(CodeModeArtifactStorage, artifactStorage),
          Effect.provideService(CodeModeRuntimeEnvironment, environment),
        );
      } else {
        result = yield* buildSequenceDiagram({
          spec: document.spec,
          options: {
            artifactFormats: ["scene", "excalidraw"],
            inlineArtifacts: ["scene", "excalidraw"],
          },
        }).pipe(
          Effect.provideService(CodeModeArtifactStorage, artifactStorage),
          Effect.provideService(CodeModeRuntimeEnvironment, environment),
        );
      }
      if (!result.ok) return yield* failureFromBuild(result);

      const id = yield* validateStorageId(documentId(document));
      const scene = yield* inlineArtifact(result.artifact, "scene").pipe(
        Effect.flatMap(decodeScene),
      );
      const excalidraw = yield* inlineArtifact(
        result.artifact,
        "excalidraw",
      ).pipe(Effect.flatMap(decodeExcalidraw));

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
