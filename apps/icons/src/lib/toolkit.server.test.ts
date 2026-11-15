// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { IconToolHandlers, IconToolkit, IconToolSource } from "./toolkit.server";

describe("shared Icons Toolkit", () => {
	it.effect(
		"uses injected source services independently of MCP and keeps concurrent origins isolated",
		() =>
			Effect.gen(function* () {
				const load = (origin: string) =>
					Effect.gen(function* () {
						const toolkit = yield* IconToolkit;
						return yield* (yield* toolkit.handle("get_icon", { slug: "kubernetes" })).pipe(
							Stream.runCollect,
						);
					}).pipe(
						Effect.provide(IconToolHandlers),
						Effect.provideService(IconToolSource, {
							origin,
							sourceLoader: async (request) =>
								`<svg data-origin="${new URL(request.url).origin}" />`,
						}),
					);
				const [first, second] = yield* Effect.all(
					[load("https://one.test"), load("https://two.test")],
					{ concurrency: "unbounded" },
				);
				expect(first).toMatchObject([
					{
						isFailure: false,
						result: {
							svg: '<svg data-origin="https://one.test" />',
							svgUrl: "https://one.test/api/icons/kubernetes.svg",
						},
					},
				]);
				expect(second).toMatchObject([
					{
						isFailure: false,
						result: {
							svg: '<svg data-origin="https://two.test" />',
							svgUrl: "https://two.test/api/icons/kubernetes.svg",
						},
					},
				]);
			}),
	);
});
