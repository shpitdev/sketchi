import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { builtDiagram } from "./__tests__/fixtures.js";
import { codeModeFailure, decodeInlineArtifacts } from "./code-mode-artifacts.js";

describe("Code Mode CLI artifact boundary", () => {
	it.effect(
		"requires both inline artifacts for builds and patches but permits detached exports",
		() =>
			Effect.gen(function* () {
				const diagram = builtDiagram();
				const formats = [{ format: "excalidraw", inline: diagram.excalidraw }];
				const detached = yield* decodeInlineArtifacts({ formats }, "export");
				assert.isUndefined(detached.scene);
				assert.deepStrictEqual(JSON.parse(JSON.stringify(detached.excalidraw)), diagram.excalidraw);
				for (const operation of ["build", "patch"] satisfies Array<"build" | "patch">) {
					const error = yield* Effect.flip(decodeInlineArtifacts({ formats }, operation));
					assert.strictEqual(error.status, "missing_inline_artifact");
					assert.deepStrictEqual(error.details, ["scene"]);
					assert.strictEqual(
						error.message,
						`Code Mode did not return the ${operation === "patch" ? "patched " : ""}scene artifact inline.`,
					);
					const decoded = yield* decodeInlineArtifacts(
						{
							formats: [{ format: "scene", inline: diagram.scene }, ...formats],
						},
						operation,
					);
					assert.deepStrictEqual(JSON.parse(JSON.stringify(decoded.scene)), diagram.scene);
				}
			}),
	);

	it("keeps build and patch failure classifications and fallback wording distinct", () => {
		assert.strictEqual(
			codeModeFailure({ status: "quality_failed", issues: [] }, "build")._tag,
			"CliValidationError",
		);
		assert.strictEqual(
			codeModeFailure({ status: "target_not_found", issues: [] }, "patch")._tag,
			"CliValidationError",
		);
		assert.strictEqual(
			codeModeFailure({ status: "storage_failed", issues: [] }, "build")._tag,
			"CliStorageError",
		);
		const build = codeModeFailure({ status: "render_failed", issues: [] }, "build");
		const patch = codeModeFailure({ status: "render_failed", issues: [] }, "patch");
		assert.strictEqual(build.message, "Code Mode failed with render_failed.");
		assert.strictEqual(build.hint, "Repair the document and retry.");
		assert.strictEqual(patch.message, "Code Mode patch failed with render_failed.");
		assert.strictEqual(patch.hint, "Repair the patch request and retry.");
	});
});
