#!/usr/bin/env node

import { NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";

import { CliApplicationLayer, cliProgram } from "./cli";

const MainLayer = Layer.provideMerge(CliApplicationLayer, NodeServices.layer);

const main = cliProgram(process.argv.slice(2)).pipe(
	Effect.tap((exitCode) =>
		Effect.sync(() => {
			process.exitCode = exitCode;
		}),
	),
	// @effect-diagnostics-next-line strictEffectProvide:off -- The Node CLI entry point provides its host layer before runMain.
	Effect.provide(MainLayer),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
