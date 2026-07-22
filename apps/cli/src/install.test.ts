import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";

const workspaceRoot = resolve(process.cwd());
const installScript = resolve(workspaceRoot, "install.sh");
const memoryRoot = resolve(workspaceRoot, ".memory");
const testRoots: string[] = [];

function makeTestRoot(): string {
  mkdirSync(memoryRoot, { recursive: true });
  const root = mkdtempSync(resolve(memoryRoot, "cli-installer-test-"));
  testRoots.push(root);
  return root;
}

function writeExecutable(path: string, lines: ReadonlyArray<string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\nset -eu\n${lines.join("\n")}\n`, "utf8");
  chmodSync(path, 0o755);
}

function writeFakeNpm(binDirectory: string): void {
  writeExecutable(resolve(binDirectory, "npm"), [
    'printf \'%s\\n\' "$@" >"$SKETCHI_TEST_NPM_ARGS"',
  ]);
}

function writeSuccessfulSketchi(binDirectory: string): void {
  writeExecutable(resolve(binDirectory, "sketchi"), [
    'if [ "$1" != "--completions" ]; then exit 9; fi',
    'case "$2" in',
    "  zsh)",
    "    printf '%s\\n' '#compdef sketchi' '_sketchi() { :; }' 'compdef _sketchi sketchi'",
    "    ;;",
    "  bash)",
    "    printf '%s\\n' '_sketchi() { :; }' 'complete -F _sketchi sketchi'",
    "    ;;",
    "  fish)",
    "    printf '%s\\n' 'complete -c sketchi'",
    "    ;;",
    "  *) exit 9 ;;",
    "esac",
  ]);
}

function installerEnvironment(root: string, shell: string): NodeJS.ProcessEnv {
  const binDirectory = resolve(root, "bin");
  const home = resolve(root, "home");
  mkdirSync(home, { recursive: true });
  return {
    HOME: home,
    PATH: `${binDirectory}:/usr/bin:/bin`,
    SHELL: shell,
    SKETCHI_TEST_NPM_ARGS: resolve(root, "npm-args.txt"),
    XDG_CONFIG_HOME: resolve(home, ".config"),
    ZDOTDIR: home,
  };
}

function runInstaller(environment: NodeJS.ProcessEnv) {
  return spawnSync("/bin/sh", [installScript], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: environment,
  });
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("noninteractive installer", () => {
  it("does not execute when the download ends before the final main invocation", () => {
    const root = makeTestRoot();
    const environment = installerEnvironment(root, "/bin/bash");
    const source = readFileSync(installScript, "utf8");
    const invocation = 'main "$@"\n';

    expect(source.endsWith(invocation)).toBe(true);

    const result = spawnSync("/bin/sh", [], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: environment,
      input: source.slice(0, -invocation.length),
    });

    expect(result.status).toBe(0);
    expect(existsSync(resolve(root, "npm-args.txt"))).toBe(false);
    expect(existsSync(resolve(root, "home/.sketchi"))).toBe(false);
  });

  it("canonicalizes the tarball and installs one vanilla-zsh-safe block", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const archive = resolve(root, "packages", "sketchi-local.tgz");
    const rcFile = resolve(home, ".zshrc");
    mkdirSync(dirname(archive), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(archive, "local package fixture\n", "utf8");
    writeFileSync(rcFile, "export EXISTING_SETTING=1\n", "utf8");
    chmodSync(rcFile, 0o640);
    writeFakeNpm(binDirectory);
    writeSuccessfulSketchi(binDirectory);

    const environment = installerEnvironment(root, "/bin/zsh");
    environment["SKETCHI_INSTALL_PACKAGE"] = relative(workspaceRoot, archive);

    const first = runInstaller(environment);
    const second = runInstaller(environment);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(
      readFileSync(resolve(root, "npm-args.txt"), "utf8").split("\n"),
    ).toEqual(["install", "-g", realpathSync(archive), ""]);

    const rc = readFileSync(rcFile, "utf8");
    expect(occurrences(rc, "# BEGIN sketchi completions")).toBe(1);
    expect(occurrences(rc, "# END sketchi completions")).toBe(1);
    expect(rc).toContain("autoload -Uz compinit");
    expect(rc).toContain("(( ${+functions[compdef]} )) || compinit");
    expect(rc).toContain('source "$HOME/.sketchi/completions/sketchi.zsh"');
    expect(statSync(rcFile).mode & 0o777).toBe(0o640);

    const completionFile = resolve(home, ".sketchi/completions/sketchi.zsh");
    expect(readFileSync(completionFile, "utf8")).toContain(
      "compdef _sketchi sketchi",
    );
    expect(
      readdirSync(dirname(completionFile)).filter((name) =>
        name.includes(".sketchi."),
      ),
    ).toEqual([]);

    if (existsSync("/usr/bin/zsh")) {
      const vanillaZsh = spawnSync(
        "/usr/bin/zsh",
        ["-dfc", 'source "$1"', "zsh", rcFile],
        {
          encoding: "utf8",
          env: {
            HOME: home,
            PATH: "/usr/bin:/bin",
            ZDOTDIR: home,
          },
        },
      );
      expect(vanillaZsh.status).toBe(0);
      expect(vanillaZsh.stderr).toBe("");
    }
  });

  it("rewrites the target of a relative rc symlink chain", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const dotfiles = resolve(root, "dotfiles");
    const rcFile = resolve(home, ".bashrc");
    const intermediateLink = resolve(dotfiles, "bashrc-link");
    const targetFile = resolve(dotfiles, "shell/bashrc");
    mkdirSync(dirname(targetFile), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(targetFile, "export MANAGED_DOTFILES=1\n", "utf8");
    chmodSync(targetFile, 0o640);
    symlinkSync("shell/bashrc", intermediateLink);
    symlinkSync("../dotfiles/bashrc-link", rcFile);
    writeFakeNpm(binDirectory);
    writeSuccessfulSketchi(binDirectory);

    const environment = installerEnvironment(root, "/bin/bash");
    const first = runInstaller(environment);
    const second = runInstaller(environment);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(lstatSync(rcFile).isSymbolicLink()).toBe(true);
    expect(readlinkSync(rcFile)).toBe("../dotfiles/bashrc-link");
    expect(lstatSync(intermediateLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(intermediateLink)).toBe("shell/bashrc");
    expect(statSync(targetFile).mode & 0o777).toBe(0o640);

    const rc = readFileSync(targetFile, "utf8");
    expect(rc).toContain("export MANAGED_DOTFILES=1");
    expect(occurrences(rc, "# BEGIN sketchi completions")).toBe(1);
    expect(occurrences(rc, "# END sketchi completions")).toBe(1);
    expect(
      readdirSync(dirname(targetFile)).filter((name) =>
        name.includes(".sketchi."),
      ),
    ).toEqual([]);
  });

  it("fails closed without replacing an rc symlink loop", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const rcFile = resolve(home, ".bashrc");
    const secondLink = resolve(home, ".bashrc-loop");
    mkdirSync(home, { recursive: true });
    symlinkSync(".bashrc-loop", rcFile);
    symlinkSync(".bashrc", secondLink);
    writeFakeNpm(binDirectory);
    writeSuccessfulSketchi(binDirectory);

    const result = runInstaller(installerEnvironment(root, "/bin/bash"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("symlink chain exceeds 40 links");
    expect(lstatSync(rcFile).isSymbolicLink()).toBe(true);
    expect(readlinkSync(rcFile)).toBe(".bashrc-loop");
    expect(lstatSync(secondLink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(secondLink)).toBe(".bashrc");
  });

  it("guards Bash completions by version and sources them on supported Bash", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const rcFile = resolve(home, ".bashrc");
    const completionFile = resolve(home, ".sketchi/completions/sketchi.bash");
    writeFakeNpm(binDirectory);
    writeSuccessfulSketchi(binDirectory);

    const install = runInstaller(installerEnvironment(root, "/bin/bash"));

    expect(install.status).toBe(0);
    expect(readFileSync(rcFile, "utf8")).toContain("[4-9].* | [1-9][0-9]*.*)");

    const supported = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", "-c", '. "$1"', "bash", rcFile],
      {
        encoding: "utf8",
        env: { HOME: home, PATH: "/usr/bin:/bin" },
      },
    );
    expect(supported.status).toBe(0);
    expect(supported.stderr).toBe("");

    writeFileSync(completionFile, "exit 99\n", "utf8");
    const simulatedRcFile = resolve(root, "bash-3.2-rc");
    writeFileSync(
      simulatedRcFile,
      readFileSync(rcFile, "utf8").replace(
        "${BASH_VERSION:-}",
        "${SKETCHI_TEST_BASH_VERSION:-}",
      ),
      "utf8",
    );
    const stockMacOsBash = spawnSync("/bin/bash", [simulatedRcFile], {
      encoding: "utf8",
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        SKETCHI_TEST_BASH_VERSION: "3.2.57(1)-release",
      },
    });
    expect(stockMacOsBash.status).toBe(0);
    expect(stockMacOsBash.stderr).toBe("");
  });

  it("cleans temporary files and exits nonzero when signaled", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const completionDirectory = resolve(home, ".sketchi/completions");
    writeFakeNpm(binDirectory);
    writeExecutable(resolve(binDirectory, "sketchi"), [
      'if [ "$1" != "--completions" ]; then exit 9; fi',
      "printf '%s\\n' 'completion-before-signal'",
      'kill -TERM "$PPID"',
    ]);

    const result = runInstaller(installerEnvironment(root, "/bin/bash"));

    expect(result.status).toBe(143);
    expect(existsSync(resolve(completionDirectory, "sketchi.bash"))).toBe(
      false,
    );
    expect(
      readdirSync(completionDirectory).filter((name) =>
        name.includes(".sketchi."),
      ),
    ).toEqual([]);
    expect(existsSync(resolve(home, ".bashrc"))).toBe(false);
  });

  it("fails when npm succeeds without installing a sketchi command", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    writeFakeNpm(binDirectory);
    const environment = installerEnvironment(root, "");
    environment["PATH"] = binDirectory;
    delete environment["SHELL"];

    const result = runInstaller(environment);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "the sketchi command is not available on PATH",
    );
  });

  it("preserves an existing completion file after partial failed output", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const completionFile = resolve(home, ".sketchi/completions/sketchi.bash");
    const rcFile = resolve(home, ".bashrc");
    mkdirSync(dirname(completionFile), { recursive: true });
    writeFileSync(completionFile, "known-good-completions\n", "utf8");
    writeFileSync(rcFile, "known-good-rc\n", "utf8");
    writeFakeNpm(binDirectory);
    writeExecutable(resolve(binDirectory, "sketchi"), [
      "printf 'partial-completions\\n'",
      "exit 12",
    ]);

    const result = runInstaller(installerEnvironment(root, "/bin/bash"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not generate bash completions");
    expect(readFileSync(completionFile, "utf8")).toBe(
      "known-good-completions\n",
    );
    expect(readFileSync(rcFile, "utf8")).toBe("known-good-rc\n");
    expect(
      readdirSync(dirname(completionFile)).filter((name) =>
        name.includes(".sketchi."),
      ),
    ).toEqual([]);
  });

  it("preserves the rc file and its mode when the rewrite fails", () => {
    const root = makeTestRoot();
    const binDirectory = resolve(root, "bin");
    const home = resolve(root, "home");
    const rcFile = resolve(home, ".bashrc");
    mkdirSync(home, { recursive: true });
    writeFileSync(rcFile, "preserve-this-rc\n", "utf8");
    chmodSync(rcFile, 0o640);
    writeFakeNpm(binDirectory);
    writeSuccessfulSketchi(binDirectory);
    writeExecutable(resolve(binDirectory, "awk"), [
      "printf 'partial-rc\\n'",
      "exit 2",
    ]);

    const result = runInstaller(installerEnvironment(root, "/bin/bash"));

    expect(result.status).toBe(1);
    expect(readFileSync(rcFile, "utf8")).toBe("preserve-this-rc\n");
    expect(statSync(rcFile).mode & 0o777).toBe(0o640);
    expect(
      readdirSync(home).filter((name) => name.startsWith(".bashrc.sketchi.")),
    ).toEqual([]);
  });
});
