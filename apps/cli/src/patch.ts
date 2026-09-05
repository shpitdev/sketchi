import {
  ApplyDiagramPatchRequestSchema,
  CodeModeArtifactStorage,
  CodeModeRuntimeEnvironment,
  ExcalidrawFileSchema,
  RenderedDiagramSceneSchema,
  applyDiagramPatch,
  type ApplyDiagramPatchRequest,
  type ApplyDiagramPatchResult,
  type CodeModeIssue,
  type ExcalidrawFile,
  type PatchableScene,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import type { PatchedDiagramArtifacts } from "./contracts.js";
import {
  CliBuildError,
  CliInputError,
  CliStorageError,
  CliValidationError,
} from "./errors.js";

export interface CliPatchInput {
  readonly operations: ApplyDiagramPatchRequest["operations"];
  readonly options?: ApplyDiagramPatchRequest["options"];
  readonly intent?: string;
}

type PatchArtifact = Extract<
  ApplyDiagramPatchResult,
  { readonly ok: true }
>["artifact"];

function validationError(
  message: string,
  details: ReadonlyArray<string>,
): CliValidationError {
  return CliValidationError.make({
    message,
    hint: "Provide operations and optional options or intent only.",
    details,
  });
}

export const decodePatchInput = Effect.fn("sketchi.cli.patch.decodeInput")(
  function* (input: unknown) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return yield* validationError("The diagram patch request is invalid.", [
        "patch: Expected an object.",
      ]);
    }
    if ("source" in input) {
      return yield* validationError(
        "The diagram patch request cannot supply source.",
        ["source: The CLI binds the stored scene."],
      );
    }
    if ("requestId" in input) {
      return yield* validationError(
        "The diagram patch request cannot supply requestId.",
        ["requestId: The CLI owns the patch request id."],
      );
    }
    const parsed = ApplyDiagramPatchRequestSchema.safeParse({
      ...input,
      requestId: "cli-patch-validation",
      source: {
        scene: {
          kind: "canvas",
          version: 1,
          diagramId: "validation",
          title: "Validation",
          width: 1,
          height: 1,
          accentColor: "#000000",
          backgroundColor: "#ffffff",
          elements: [],
          layers: [],
          layouts: [],
          zOrder: [],
        },
      },
    });
    if (!parsed.success) {
      return yield* validationError(
        "The diagram patch request is invalid.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    return {
      operations: parsed.data.operations,
      ...(parsed.data.options ? { options: parsed.data.options } : {}),
      ...(parsed.data.intent ? { intent: parsed.data.intent } : {}),
    } satisfies CliPatchInput;
  },
);

export const parseJsonPatchInput = Effect.fn("sketchi.cli.patch.parseJson")(
  function* (text: string) {
    const input: unknown = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () =>
        CliInputError.make({
          code: "invalid_json",
          message: "The patch input is not valid JSON.",
          hint: "Pass one complete diagram patch request object.",
        }),
    });
    return yield* decodePatchInput(input);
  },
);

export class DiagramPatcher extends Context.Service<
  DiagramPatcher,
  {
    readonly patch: (
      scene: PatchableScene,
      input: CliPatchInput,
      requestId: string,
    ) => Effect.Effect<
      PatchedDiagramArtifacts,
      CliBuildError | CliStorageError | CliValidationError
    >;
  }
>()("@sketchi/cli/DiagramPatcher") {}

function issueDetail(issue: CodeModeIssue): string {
  const path = issue.ref?.path ? ` (${issue.ref.path})` : "";
  return `${issue.code}${path}: ${issue.message}`;
}

function patchFailure(
  result: Extract<ApplyDiagramPatchResult, { readonly ok: false }>,
): CliBuildError | CliStorageError | CliValidationError {
  const first = result.issues[0];
  const message =
    first?.message ?? `Code Mode patch failed with ${result.status}.`;
  const hint = first?.hint ?? "Repair the patch request and retry.";
  const details = result.issues.map(issueDetail);
  if (
    result.status === "invalid_input" ||
    result.status === "target_not_found" ||
    result.status === "unsupported_operation" ||
    result.status === "connectivity_changed"
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
  artifact: PatchArtifact,
  format: "scene" | "excalidraw",
): Effect.Effect<unknown, CliBuildError> {
  const ref = artifact.formats.find((candidate) => candidate.format === format);
  if (ref?.inline !== undefined) return Effect.succeed(ref.inline);
  return Effect.fail(
    CliBuildError.make({
      status: "missing_inline_artifact",
      message: `Code Mode did not return the patched ${format} artifact inline.`,
      hint: "Retry the offline patch with the required artifact formats.",
      details: [format],
    }),
  );
}

function decodeScene(
  value: unknown,
): Effect.Effect<PatchableScene, CliBuildError> {
  const decoded = RenderedDiagramSceneSchema.safeParse(value);
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(
        CliBuildError.make({
          status: "invalid_scene_artifact",
          message: "Code Mode returned an invalid patched scene artifact.",
          hint: "Inspect the Code Mode patch/export boundary.",
          details: decoded.error.issues.map((issue) => issue.message),
        }),
      );
}

function decodeExcalidraw(
  value: unknown,
): Effect.Effect<ExcalidrawFile, CliBuildError> {
  const decoded = ExcalidrawFileSchema.safeParse(value);
  return decoded.success
    ? Effect.succeed(decoded.data)
    : Effect.fail(
        CliBuildError.make({
          status: "invalid_excalidraw_artifact",
          message: "Code Mode returned an invalid patched Excalidraw artifact.",
          hint: "Inspect the Code Mode patch/export boundary.",
          details: decoded.error.issues.map((issue) => issue.message),
        }),
      );
}

export const DiagramPatcherLive = Layer.effect(
  DiagramPatcher,
  Effect.gen(function* () {
    const artifactStorage = yield* CodeModeArtifactStorage;
    const environment = yield* CodeModeRuntimeEnvironment;

    const patch = Effect.fn("sketchi.cli.diagram.patch")(function* (
      scene: PatchableScene,
      input: CliPatchInput,
      requestId: string,
    ) {
      const result = yield* applyDiagramPatch({
        requestId,
        source: { scene },
        operations: input.operations,
        options: {
          ...input.options,
          artifactFormats: ["scene", "excalidraw"],
          inlineArtifacts: ["scene", "excalidraw"],
        },
        ...(input.intent ? { intent: input.intent } : {}),
      }).pipe(
        Effect.provideService(CodeModeArtifactStorage, artifactStorage),
        Effect.provideService(CodeModeRuntimeEnvironment, environment),
      );
      if (!result.ok) return yield* patchFailure(result);
      const patchedScene = yield* inlineArtifact(result.artifact, "scene").pipe(
        Effect.flatMap(decodeScene),
      );
      const excalidraw = yield* inlineArtifact(
        result.artifact,
        "excalidraw",
      ).pipe(Effect.flatMap(decodeExcalidraw));
      return {
        scene: patchedScene,
        excalidraw,
      } satisfies PatchedDiagramArtifacts;
    });

    return { patch };
  }),
);
