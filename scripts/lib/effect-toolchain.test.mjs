import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = join(root, "tsconfig.base.json");
const compiler = join(root, "node_modules/@effect/tsgo/dist/effect-tsgo.cjs");

function compile(config, ...args) {
	return spawnSync(process.execPath, [compiler, "tsc@7.0.2", "-p", config, ...args], {
		cwd: root,
		encoding: "utf8",
		timeout: 30_000,
	});
}

function fixture(t, source, compilerOptions = {}) {
	const memory = join(root, ".memory/effect-toolchain");
	mkdirSync(memory, { recursive: true });
	const directory = mkdtempSync(join(memory, "compiler-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const config = join(directory, "tsconfig.json");
	writeFileSync(config, JSON.stringify({ extends: base, compilerOptions, files: ["input.ts"] }));
	writeFileSync(join(directory, "input.ts"), source);
	return { directory, config };
}

test("workspace compiler rejects discarded Effects and missing services but permits migration warnings", (t) => {
	const { directory, config } = fixture(
		t,
		`import { Effect } from "effect";
export async function pendingMigration() { return 1; }
export const program = Effect.succeed(1);
/** @stability experimental */
export const experimental = () => 1;
/** @stability unstable */
export const unstable = () => 2;
export const accepted = experimental() + unstable();
`,
	);
	const warnings = compile(config, "--noEmit", "--pretty", "false");
	assert.equal(warnings.status, 0, warnings.stdout + warnings.stderr);
	assert.match(warnings.stdout, /warning .*effect\(asyncFunction\)/);
	assert.doesNotMatch(warnings.stdout, /effect\((?:experimentalApiUsage|unstableApiUsage)\)/);

	writeFileSync(
		join(directory, "input.ts"),
		`import { Context, Effect } from "effect";
class Database extends Context.Service<Database, { readonly name: string }>()("Database") {}
Effect.succeed("discarded");
export const missing: Effect.Effect<void> = Database.pipe(Effect.asVoid);
`,
	);
	const errors = compile(config, "--noEmit", "--pretty", "false");
	assert.notEqual(errors.status, 0);
	assert.match(errors.stdout, /error .*effect\(floatingEffect\)/);
	assert.match(errors.stdout, /error .*effect\(missingEffectContext\)/);
});

test("native emit produces executable code and declarations that constrain a separate consumer", async (t) => {
	const { directory, config } = fixture(
		t,
		`import { Effect } from "effect";
export const greet = (name: string): Effect.Effect<string> => Effect.succeed("Hello " + name);
`,
		{ noEmit: false, declaration: true, declarationMap: true, outDir: "dist" },
	);
	const emitted = compile(config, "--pretty", "false");
	assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr);
	assert.ok(readFileSync(join(directory, "dist/input.d.ts.map"), "utf8"));
	// The consumer must resolve the built declarations, never the original source.
	rmSync(join(directory, "input.ts"));
	const consumer = join(directory, "consumer.json");
	writeFileSync(consumer, JSON.stringify({ extends: base, files: ["consumer.ts"] }));
	writeFileSync(
		join(directory, "consumer.ts"),
		`import { Effect } from "effect";
import { greet } from "./dist/input.js";
export const message: Effect.Effect<string> = greet("Sketchi");
`,
	);
	const valid = compile(consumer, "--noEmit", "--pretty", "false");
	assert.equal(valid.status, 0, valid.stdout + valid.stderr);
	const { greet } = await import(pathToFileURL(join(directory, "dist/input.js")).href);
	const { Effect } = await import("effect");
	assert.equal(Effect.runSync(greet("Sketchi")), "Hello Sketchi");
	writeFileSync(
		join(directory, "consumer.ts"),
		`import { Effect } from "effect";
import { greet } from "./dist/input.js";
export const message: Effect.Effect<number> = greet("Sketchi");
`,
	);
	const invalid = compile(consumer, "--noEmit", "--pretty", "false");
	assert.notEqual(invalid.status, 0);
	assert.match(invalid.stdout, /Type 'string' is not assignable to type 'number'/);
});
