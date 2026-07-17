import { describe, expect, it } from "vitest";

import { parseCliOptions, resolveGeneratorCommand } from "./cli-options";

describe("scenario CLI options", () => {
  it("keeps a direct multiword generator command together", () => {
    const options = parseCliOptions([
      "--scenario",
      "sketchi-onboarding-decision-flow",
      "--generator-command",
      "opencode",
      "run",
      "--model",
      "gpt-5",
    ]);

    expect(options.generatorCommand).toBe("opencode run --model gpt-5");
  });

  it("parses all-scenario regression output options", () => {
    const options = parseCliOptions([
      "--all",
      "--fixture",
      "--out-dir",
      ".memory/scenarios",
      "--candidate-out-dir",
      ".memory/candidates",
      "--report-out",
      ".memory/report.json",
      "--repeat",
      "5",
    ]);

    expect(options).toEqual(
      expect.objectContaining({
        all: true,
        candidateOutDir: ".memory/candidates",
        outDir: ".memory/scenarios",
        repeat: 5,
        reportOut: ".memory/report.json",
        useFixture: true,
      }),
    );
  });

  it("rejects invalid repeat counts", () => {
    expect(() => parseCliOptions(["--all", "--repeat", "0"])).toThrow(
      "--repeat must be a positive integer.",
    );
  });

  it("resolves the default generator command environment variable", () => {
    const options = parseCliOptions([
      "--scenario",
      "sketchi-onboarding-decision-flow",
    ]);

    expect(
      resolveGeneratorCommand(options, {
        SKETCHI_GENERATOR_COMMAND: "opencode run",
      }),
    ).toBe("opencode run");
  });

  it("requires explicitly named generator command environment variables", () => {
    const options = parseCliOptions([
      "--scenario",
      "sketchi-onboarding-decision-flow",
      "--generator-command-env",
      "CUSTOM_PROVIDER_COMMAND",
    ]);

    expect(() => resolveGeneratorCommand(options, {})).toThrow(
      'Environment variable "CUSTOM_PROVIDER_COMMAND" is empty or unset.',
    );
  });
});
