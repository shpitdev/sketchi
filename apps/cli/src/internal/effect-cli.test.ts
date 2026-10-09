import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { assert, describe, it } from "@effect/vitest";

import type { OutputFormat } from "../contracts.js";
import { requestedOutputFormat } from "./effect-cli.js";

describe("requested output format", () => {
  const cases = [
    [[], "text"],
    [["list", "--output", "json"], "json"],
    [["list", "--output=json"], "json"],
    [["--output", "text", "--output=json"], "text"],
    [["--output=json", "--output", "text"], "json"],
    [["--output", "json", "--output", "text"], "json"],
    [["--output=text", "--output=json"], "text"],
    [["--", "--output=json"], "text"],
    [["--output", "invalid", "--output=json"], "text"],
  ] satisfies ReadonlyArray<readonly [ReadonlyArray<string>, OutputFormat]>;

  it.each(cases)(
    "uses the parser's first-value rule for %j",
    (args, expected) => {
      assert.strictEqual(requestedOutputFormat(args), expected);
    },
  );

  it("formats usage failures like successful commands with repeated output flags", () => {
    mkdirSync(resolve(".memory/s9-output-home"), { recursive: true });
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: resolve(".memory/s9-output-home"),
    };
    delete environment["FORCE_COLOR"];
    delete environment["NO_COLOR"];
    for (const [first, second] of [
      ["text", "json"],
      ["json", "text"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          resolve("apps/cli/dist/sketchi.js"),
          "list",
          "--output",
          first!,
          "--output",
          second!,
          "--bogus",
        ],
        {
          encoding: "utf8",
          env: environment,
        },
      );
      assert.strictEqual(result.status, 2);
      if (first === "text") {
        assert.match(result.stdout, /^DESCRIPTION/u);
        assert.match(result.stderr, /^error: usage_error/u);
      } else {
        assert.strictEqual(result.stdout, "");
        assert.strictEqual(JSON.parse(result.stderr).error.code, "usage_error");
      }
      const success = spawnSync(
        process.execPath,
        [
          resolve("apps/cli/dist/sketchi.js"),
          "list",
          "--output",
          first!,
          "--output",
          second!,
        ],
        {
          encoding: "utf8",
          env: environment,
        },
      );
      assert.strictEqual(success.status, 0);
      assert.strictEqual(success.stderr, "");
      if (first === "text") assert.strictEqual(success.stdout, "no diagrams\n");
      else assert.strictEqual(JSON.parse(success.stdout).ok, true);
    }
  });
});

// Exercise the public combinators through the packaged command, including repeats.
describe("input-source exclusivity", () => {
  it.each(["canvas", "create", "edit", "patch"])(
    "keeps %s duplicate sources in the JSON usage envelope",
    (command) => {
      const environment: NodeJS.ProcessEnv = { ...process.env };
      delete environment["FORCE_COLOR"];
      delete environment["NO_COLOR"];
      for (const flag of ["--file", "--json"]) {
        const result = spawnSync(
          process.execPath,
          [
            resolve("apps/cli/dist/sketchi.js"),
            command,
            ...(["edit", "patch"].includes(command) ? ["release-flow"] : []),
            flag,
            "first",
            flag,
            "second",
            "--output",
            "json",
          ],
          { encoding: "utf8", env: environment },
        );
        assert.strictEqual(result.status, 2);
        assert.strictEqual(result.stdout, "");
        const error = JSON.parse(result.stderr).error;
        assert.strictEqual(error.code, "usage_error");
        assert.include(error.message, "more than one source provided");
        assert.include(
          error.message,
          "exactly one of --file PATH|- or --json VALUE",
        );
      }
    },
  );
});
