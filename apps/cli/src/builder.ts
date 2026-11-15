import { buildResponse } from "@sketchi/diagrams/build/operation";
import { CodeModeArtifactStorage } from "@sketchi/diagrams/build/code-mode/artifacts";
import { buildCanonicalDocument } from "@sketchi/diagrams/build/code-mode/documents";
import { CodeModeRuntimeEnvironment } from "@sketchi/diagrams/build/code-mode/runtime";
import { type FamilyBuildResult } from "@sketchi/diagrams/family";
import { Context, Effect, Layer } from "effect";

import { codeModeFailure, decodeInlineArtifacts, withCodeMode } from "./code-mode-artifacts.js";
import type { BuiltDiagram } from "./contracts.js";
import { documentId, validateStorageId, type CanonicalDiagramDocument } from "./document.js";
import { CliBuildError, CliStorageError, CliValidationError } from "./errors.js";

export class DiagramBuilder extends Context.Service<
	DiagramBuilder,
	{
		readonly build: (
			document: CanonicalDiagramDocument,
		) => Effect.Effect<BuiltDiagram, CliBuildError | CliStorageError | CliValidationError>;
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
			const result: FamilyBuildResult = yield* withCodeMode(
				artifactStorage,
				environment,
				(options) => buildResponse(buildCanonicalDocument(document, options)),
			);
			if (!result.ok) return yield* codeModeFailure(result, "build");
			const id = yield* validateStorageId(documentId(document));
			const { scene, excalidraw } = yield* decodeInlineArtifacts(result.artifact, "build");
			return {
				id,
				warnings: result.issues.filter((entry) => entry.severity === "warning"),
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
