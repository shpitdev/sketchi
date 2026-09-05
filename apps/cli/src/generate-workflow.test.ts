import { assert, describe, it } from "@effect/vitest";

import { CliExportError, CliFilesystemError } from "./errors.js";
import { preserveGeneratedRecordOnExportFailure } from "./generate-workflow.js";

describe("post-generation export recovery", () => {
  it("attaches the persisted identity and a concrete retry to write failures", () => {
    const failure = preserveGeneratedRecordOnExportFailure(
      CliExportError.make({
        code: "export_write_failed",
        format: "proof.png",
        message: "Export destination directory does not exist.",
        hint: "Create the destination directory and retry.",
      }),
      "release-approval",
      "png",
    );

    assert.strictEqual(failure.diagramId, "release-approval");
    assert.strictEqual(
      failure.storagePath,
      "~/.sketchi/diagrams/release-approval",
    );
    assert.strictEqual(
      failure.recoveryCommand,
      "sketchi export release-approval --format png --dest release-approval.png",
    );
    assert.include(failure.hint, "The canonical record is preserved.");
  });

  it("turns a destination filesystem failure into a recoverable export error", () => {
    const failure = preserveGeneratedRecordOnExportFailure(
      CliFilesystemError.make({
        cause: new Error("permission denied"),
        operation: "mkdir",
        path: "diagrams",
        message: "Unable to create the project diagrams directory.",
      }),
      "login-sequence",
      "excalidraw",
    );

    assert.strictEqual(failure.code, "export_write_failed");
    assert.strictEqual(failure.diagramId, "login-sequence");
    assert.deepStrictEqual(failure.details, [
      "filesystem_operation:mkdir",
      "path:diagrams",
    ]);
    assert.strictEqual(
      failure.recoveryCommand,
      "sketchi export login-sequence --format excalidraw --dest login-sequence.excalidraw",
    );
  });
});
