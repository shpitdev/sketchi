import { describe, expect, it } from "vitest";

import {
  DiagramGenerationHttpError,
  DiagramGenerationTransportError,
  generationErrorToCandidate,
} from "./errors.js";

describe("generation error candidates", () => {
  for (const model of [
    "google/gemini-test",
    "google-ai-studio/gemini-test",
    "gemini-test",
  ]) {
    it(`normalizes ${model} for both HTTP and transport failures`, () => {
      const errors = [
        DiagramGenerationHttpError.make({
          diagnostics: ["HTTP failure"],
          durationMs: 1,
          provider: "cloudflare-google-ai-studio",
          raw: {},
          retryable: false,
          status: 400,
        }),
        DiagramGenerationTransportError.make({
          cause: new Error("transport failure"),
          message: "transport failure",
          operation: "gateway.run",
          provider: "cloudflare-google-ai-studio",
          retryable: true,
        }),
      ];
      for (const error of errors) {
        expect(generationErrorToCandidate(error, { model }).model).toBe(
          "gemini-test",
        );
      }
    });
  }
});
