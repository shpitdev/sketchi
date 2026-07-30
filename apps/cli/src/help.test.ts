import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

function ttyHelp({
  colorForegroundBackground,
  colorTerminal = "truecolor",
  noColor,
  terminal = "xterm-256color",
}: {
  readonly colorForegroundBackground: string | undefined;
  readonly colorTerminal?: string | null;
  readonly noColor?: string;
  readonly terminal?: string;
}): string {
  const command = [
    JSON.stringify(process.execPath),
    JSON.stringify(binary),
    "--help",
  ].join(" ");
  const environment: NodeJS.ProcessEnv = {
    ...cliEnvironment(),
    TERM: terminal,
    ...(noColor === undefined ? {} : { NO_COLOR: noColor }),
  };
  if (colorForegroundBackground === undefined) delete environment["COLORFGBG"];
  else environment["COLORFGBG"] = colorForegroundBackground;
  delete environment["CI"];
  delete environment["GITHUB_ACTIONS"];
  if (colorTerminal === null) delete environment["COLORTERM"];
  else environment["COLORTERM"] = colorTerminal;
  const terminalCommand =
    colorForegroundBackground === undefined
      ? `env -u COLORFGBG ${command}`
      : command;

  return spawnSync(
    "script",
    ["--quiet", "--return", "--command", terminalCommand, "/dev/null"],
    {
      encoding: "utf8",
      env: environment,
    },
  ).stdout;
}

describe("golden product help", () => {
  for (const command of [
    "root",
    "docs",
    "generate",
    "create",
    "show",
    "edit",
    "patch",
    "list",
    "restore",
    "share",
    "pull",
    "export",
  ] as const) {
    it(`keeps ${command} help stable`, async () => {
      await expect(
        help(command === "root" ? undefined : command),
      ).toMatchFileSnapshot(`./__fixtures__/help/${command}.txt`);
    });
  }

  it("keeps the default help concise and points to the detailed docs", () => {
    const output = help();

    expect(output).toContain(
      'sketchi generate --prompt "Map release approval with pass and revise branches"',
    );
    expect(output).toContain("sketchi docs");
    expect(output).toContain("START HERE");
    expect(output).toContain("WORK WITH A DIAGRAM");
    expect(output).not.toContain("create      Create a local diagram");
    expect(output).not.toContain("GLOBAL FLAGS");
    expect(output).not.toContain("Canonical flowchart example");
    expect(output).not.toContain("Share/pull safety limits");
    expect(output.split("\n").length).toBeLessThan(60);
  });

  it("uses the same human help when invoked without arguments", () => {
    expect(
      execFileSync(process.execPath, [binary], {
        encoding: "utf8",
        env: cliEnvironment(),
      }),
    ).toBe(help());
  });

  it("keeps the detailed agent contracts on the explicit docs command", async () => {
    const output = execFileSync(process.execPath, [binary, "docs"], {
      encoding: "utf8",
      env: cliEnvironment(),
    });

    expect(output).toContain("Canonical flowchart example");
    expect(output).toContain("Share/pull safety limits");
    expect(output).toContain("stdout contains only artifact bytes");
    await expect(output).toMatchFileSnapshot(
      "./__fixtures__/help/agent-docs.txt",
    );
  });

  it("wraps agent documentation in the shared JSON success envelope", () => {
    const output = execFileSync(
      process.execPath,
      [binary, "docs", "--output", "json"],
      { encoding: "utf8", env: cliEnvironment() },
    );

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      command: "docs",
      data: {
        documentation: expect.stringContaining("Canonical flowchart example"),
      },
    });
  });

  it("brands automatic root help when only text output is selected", () => {
    expect(
      execFileSync(process.execPath, [binary, "--output", "text"], {
        encoding: "utf8",
        env: cliEnvironment(),
      }),
    ).toBe(help());
  });

  it("wraps every root JSON help combination without ANSI or empty output", () => {
    for (const args of [
      ["--output", "json"],
      ["--output=json"],
      ["--help", "--output", "json"],
      ["--output=json", "--help"],
    ]) {
      const output = execFileSync(process.execPath, [binary, ...args], {
        encoding: "utf8",
        env: cliEnvironment(),
      });

      expect(JSON.parse(output)).toMatchObject({
        ok: true,
        command: "sketchi",
        data: {
          help: expect.stringContaining(
            'sketchi generate --prompt "Map release approval with pass and revise branches"',
          ),
        },
      });
      expect(output).not.toContain("\u001b");
    }
  });

  it("chooses readable dark and light truecolor wordmarks", () => {
    const dark = ttyHelp({ colorForegroundBackground: "15;0" });
    expect(dark).toContain("\u001b[1;38;2;246;241;231msketchi");
    expect(dark).toContain("\u001b[1;38;2;195;154;172mSTART HERE");
    expect(ttyHelp({ colorForegroundBackground: "0;15" })).toContain(
      "\u001b[1;38;2;26;23;18msketchi",
    );
  });

  it("disables color for NO_COLOR, 4-bit terminals, and pipes", () => {
    expect(
      ttyHelp({ colorForegroundBackground: "15;0", noColor: "1" }),
    ).not.toContain("\u001b");
    expect(
      ttyHelp({
        colorForegroundBackground: "15;0",
        colorTerminal: null,
        terminal: "ansi",
      }),
    ).not.toContain("\u001b");
    expect(help()).not.toContain("\u001b");
  });

  it("uses ANSI-256 colors only when its exact palette is readable", () => {
    expect(
      ttyHelp({
        colorForegroundBackground: "15;0",
        colorTerminal: null,
      }),
    ).toContain("\u001b[1;38;5;255msketchi");
  });

  it.each([undefined, "unknown", "15;"])(
    "uses terminal-default text for unknown background %s",
    (colorForegroundBackground) => {
      expect(ttyHelp({ colorForegroundBackground })).not.toContain("\u001b");
    },
  );

  it.each(["0;7", "0;10", "0;14", "0;46", "0;82"])(
    "uses terminal-default text for unreadable ANSI-256 background %s",
    (colorForegroundBackground) => {
      expect(
        ttyHelp({ colorForegroundBackground, colorTerminal: null }),
      ).not.toContain("\u001b");
    },
  );

  it.each(["15;12", "15;13"])(
    "uses terminal-default text for unreadable truecolor background %s",
    (colorForegroundBackground) => {
      expect(ttyHelp({ colorForegroundBackground })).not.toContain("\u001b");
    },
  );

  it("keeps parser-level exclusivity failures in the JSON usage envelope", () => {
    for (const args of [
      ["generate", "--output", "json"],
      ["create", "--output", "json"],
      ["create", "--file", "a.json", "--json", "{}", "--output", "json"],
      ["edit", "release-flow", "--output", "json"],
      ["patch", "release-flow", "--output", "json"],
      [
        "patch",
        "release-flow",
        "--file",
        "a.json",
        "--json",
        "{}",
        "--output",
        "json",
      ],
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
      ["pull", "release-flow", "--output", "json"],
      [
        "pull",
        "release-flow",
        "--link",
        "https://excalidraw.com/#json=one,AAAAAAAAAAAAAAAAAAAAAA",
        "--link",
        "https://excalidraw.com/#json=two,AAAAAAAAAAAAAAAAAAAAAA",
        "--output",
        "json",
      ],
      [
        "restore",
        "release-flow",
        "--revision",
        "not-a-number",
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

  it("redacts bearer-shaped values from parser and typed error envelopes", () => {
    const bearer =
      "https://excalidraw.com/#json=AAAAAAAAAAAAAAAAAAAAAA,BBBBBBBBBBBBBBBBBBBBBB";
    for (const args of [
      [
        "pull",
        "missing",
        "--link",
        bearer,
        "--output",
        bearer,
        "--output",
        "json",
      ],
      ["pull", bearer, "--link", bearer, "--output", "json"],
    ]) {
      const result = spawnSync(process.execPath, [binary, ...args], {
        encoding: "utf8",
        env: cliEnvironment(),
      });

      expect([2, 3]).toContain(result.status);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain(bearer);
      expect(result.stderr).toContain("[redacted-share-link]");
    }
  });

  it("checks a pull target before reading a TTY-backed --link -", () => {
    mkdirSync(helpHome, { recursive: true });
    const ttyHome = mkdtempSync(resolve(helpHome, "tty-"));
    const command = [
      JSON.stringify(process.execPath),
      JSON.stringify(binary),
      "pull",
      "missing",
      "--link",
      "-",
      "--output",
      "json",
    ].join(" ");
    try {
      const result = spawnSync(
        "script",
        ["--quiet", "--return", "--command", command, "/dev/null"],
        {
          encoding: "utf8",
          env: { ...cliEnvironment(), HOME: ttyHome },
        },
      );

      expect(result.status).toBe(5);
      expect(result.stdout).toContain('"code": "diagram_not_found"');
      expect(result.stdout).not.toContain("interactive_stdin");
    } finally {
      rmSync(ttyHome, { force: true, recursive: true });
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
