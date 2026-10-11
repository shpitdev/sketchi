import {
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	buildCanonicalDocument,
	type CanonicalBuildResult,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import { codeModeFailure, decodeInlineArtifacts, withCodeMode } from "./code-mode-artifacts.js";
import type { BuiltDiagram } from "./contracts.js";
import { documentId, type CanonicalDiagramDocument, validateStorageId } from "./document.js";
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
			const result: CanonicalBuildResult = yield* withCodeMode(
				artifactStorage,
				environment,
				(options) => buildCanonicalDocument(document, options),
			);
			if (!result.ok) return yield* codeModeFailure(result, "build");
			const id = yield* validateStorageId(documentId(document));
			const { scene, excalidraw } = yield* decodeInlineArtifacts(result.artifact, "build");
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
