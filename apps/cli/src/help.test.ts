import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "@effect/vitest";

const binary = resolve(process.cwd(), "apps/cli/dist/sketchi.js");
const helpHome = resolve(process.cwd(), ".memory/cli-help-home");

function cliEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: helpHome };
  delete environment["NO_COLOR"];
  delete environment["FORCE_COLOR"];
  return environment;
}

function help(command?: string): string {
  return execFileSync(
    process.execPath,
    [binary, ...(command ? [command] : []), "--help"],
    {
      encoding: "utf8",
      env: cliEnvironment(),
    },
  );
}

function completions(shell: "bash" | "zsh"): string {
  return execFileSync(process.execPath, [binary, "--completions", shell], {
    encoding: "utf8",
    env: cliEnvironment(),
  });
}

describe("golden product help", () => {
  for (const command of [
    "root",
    "generate",
    "create",
    "show",
    "edit",
    "list",
    "export",
  ] as const) {
    it(`keeps ${command} help stable`, async () => {
      await expect(
        help(command === "root" ? undefined : command),
      ).toMatchFileSnapshot(`./__fixtures__/help/${command}.txt`);
    });
  }

  it("keeps parser-level exclusivity failures in the JSON usage envelope", () => {
    for (const args of [
      ["create", "--output", "json"],
      ["create", "--file", "a.json", "--json", "{}", "--output", "json"],
      ["edit", "release-flow", "--output", "json"],
      [
        "edit",
        "release-flow",
        "--file",
        "a.json",
        "--json",
        "{}",
        "--output",
        "json",
      ],
    ]) {
      const result = spawnSync(process.execPath, [binary, ...args], {
        encoding: "utf8",
        env: cliEnvironment(),
      });

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({
        ok: false,
        command: args[0],
        error: { code: "usage_error" },
      });
    }
  });

  it("generates installable zsh completions from the built bundle", () => {
    const output = completions("zsh");

    expect(output).toMatch(/^#compdef sketchi\n/u);
    expect(output).toContain("###-begin-sketchi-completions-###");
    expect(output).toContain("compdef _sketchi sketchi");
    expect(output).toContain("###-end-sketchi-completions-###");
  });

  it("generates installable bash completions from the built bundle", () => {
    const output = completions("bash");

    expect(output).toMatch(/^###-begin-sketchi-completions-###\n/u);
    expect(output).toContain("complete -F _sketchi sketchi");
    expect(output).toContain("###-end-sketchi-completions-###");
  });

  it("reports unsupported completion shells as a text usage error", () => {
    const result = spawnSync(
      process.execPath,
      [binary, "--completions", "powershell"],
      {
        encoding: "utf8",
        env: cliEnvironment(),
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error: usage_error");
    expect(result.stderr).toContain("powershell");
    expect(result.stderr).toContain('"bash" | "zsh" | "fish" | "sh"');
  });

  it("reports unsupported completion shells in the JSON usage envelope", () => {
    const result = spawnSync(
      process.execPath,
      [binary, "--output", "json", "--completions", "powershell"],
      {
        encoding: "utf8",
        env: cliEnvironment(),
      },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      command: "sketchi",
      error: {
        code: "usage_error",
        message: expect.stringContaining('"bash" | "zsh" | "fish" | "sh"'),
      },
    });
  });
});
