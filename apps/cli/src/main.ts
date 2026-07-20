#!/usr/bin/env node

import { NodeRuntime } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";

import { CliApplicationLayer, cliProgram } from "./cli.js";

const MainLayer = Layer.provideMerge(CliApplicationLayer, NodeServices.layer);

const main = cliProgram(process.argv.slice(2)).pipe(
  Effect.tap((exitCode) =>
    Effect.sync(() => {
      process.exitCode = exitCode;
    }),
  ),
  Effect.provide(MainLayer),
);

NodeRuntime.runMain(main, { disableErrorReporting: true });
