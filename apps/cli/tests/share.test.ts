// @effect-diagnostics nodeBuiltinImport:off -- The share contract harness owns the real HTTP socket and on-disk input/output fixtures.
// @effect-diagnostics strictEffectProvide:off -- The test is the runtime entry point for this fixture layer.

import { strict as assert } from "node:assert";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import * as NodeServices from "@effect/platform-node/NodeServices";

import {
	LinkOpener,
	ShareTransport,
	ShareTransportLive,
	makeLinkOpenerLayer,
} from "../src/share/excalidraw";
import {
	decodeSharePayload,
	encodeSharePayload,
	formatShareLink,
	parseShareLink,
	ShareCryptoLive,
} from "../src/share/protocol";

const originalFetch = globalThis.fetch;

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	return input instanceof URL ? input.href : input.url;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Excalidraw share transport", () => {
	for (const operation of ["upload", "download"] as const) {
		it.effect(`aborts ${operation} fetch on interruption`, () =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				let requestSignal: AbortSignal | null | undefined;
				globalThis.fetch = (_input, init) => {
					requestSignal = init?.signal;
					// @effect-diagnostics-next-line newPromise:off -- A controllable fetch Promise lets the test observe whether the CLI aborts the native request.
					return new Promise<Response>(() => {
						Deferred.doneUnsafe(started, Effect.void);
					});
				};
				const transport = yield* ShareTransport;
				const fiber = yield* (
					operation === "upload"
						? transport.upload(new Uint8Array())
						: transport.download("fixture_id")
				).pipe(Effect.forkChild);
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
				assert.equal(requestSignal?.aborted, true);
			}).pipe(Effect.provide(ShareTransportLive)),
		);
	}

	it.effect("bounds a stalled download and aborts its fetch", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			let requestSignal: AbortSignal | null | undefined;
			globalThis.fetch = (_input, init) => {
				requestSignal = init?.signal;
				// @effect-diagnostics-next-line newPromise:off -- A controllable fetch Promise lets the test observe whether the CLI aborts the native request.
				return new Promise<Response>(() => {
					Deferred.doneUnsafe(started, Effect.void);
				});
			};
			const transport = yield* ShareTransport;
			const fiber = yield* Effect.flip(transport.download("fixture_id")).pipe(Effect.forkChild);
			yield* Deferred.await(started);
			yield* TestClock.adjust("15 seconds");
			assert.notEqual(fiber.pollUnsafe(), undefined);
			assert.equal((yield* Fiber.join(fiber)).code, "share_timeout");
			assert.equal(requestSignal?.aborted, true);
		}).pipe(Effect.provide(ShareTransportLive)),
	);
	for (const [status, code] of [
		[404, "share_link_unavailable"],
		[503, "share_transport_failed"],
	] as const) {
		it.live(`cancels the unread streaming ${status} download at the server`, () =>
			Effect.gen(function* () {
				const disconnected = yield* Deferred.make<boolean>();
				yield* Effect.acquireUseRelease(
					Effect.promise(async () => {
						const server = createServer((_request, response) => {
							response.writeHead(status);
							response.write("error chunk\n");
							// @effect-diagnostics-next-line globalTimers:off -- The local HTTP fixture writes until the response is cancelled so the test can observe body release.
							const writes = setInterval(() => response.write("error chunk\n"), 50);
							response.once("close", () => {
								clearInterval(writes);
								Deferred.doneUnsafe(disconnected, Effect.succeed(!response.writableEnded));
							});
						});
						server.listen(0, "127.0.0.1");
						await once(server, "listening");
						return server;
					}),
					(server) =>
						Effect.gen(function* () {
							const address = server.address();
							assert.ok(address && typeof address !== "string");
							// Redirect only the destination; keep native fetch and retain the response
							// through the close check so garbage collection cannot release the body.
							let fetched: Response | undefined;
							globalThis.fetch = async (_input, init) => {
								// @effect-diagnostics-next-line globalFetch:off -- A test stub forwards this request to the real local HTTP fixture.
								fetched = await originalFetch(`http://127.0.0.1:${address.port}`, init);
								return fetched;
							};
							const transport = yield* ShareTransport;
							const failure = yield* Effect.flip(transport.download("fixture_id"));
							assert.equal(failure.code, code);
							assert.equal(yield* Deferred.await(disconnected), true);
							assert.equal(fetched?.status, status);
						}).pipe(Effect.timeout("2 seconds")),
					(server) =>
						Effect.promise(() => {
							const closed = once(server, "close");
							server.close();
							server.closeAllConnections();
							return closed;
						}),
				);
			}).pipe(Effect.provide(ShareTransportLive)),
		);
	}

	it.effect("uploads once to the pinned endpoint without redirects", () => {
		let calls = 0;
		globalThis.fetch = (input, init) => {
			calls += 1;
			assert.equal(requestUrl(input), "https://json.excalidraw.com/api/v2/post/");
			assert.equal(init?.method, "POST");
			assert.equal(init?.redirect, "error");
			assert.equal(init?.body instanceof Uint8Array, true);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: "fixture_id",
						data: "https://json.excalidraw.com/api/v2/fixture_id",
					}),
					{ status: 200 },
				),
			);
		};
		return Effect.gen(function* () {
			const transport = yield* ShareTransport;
			assert.equal(yield* transport.upload(new Uint8Array([1, 2, 3])), "fixture_id");
			assert.equal(calls, 1);
		}).pipe(Effect.provide(ShareTransportLive));
	});

	it.effect("rejects oversized upload responses while streaming", () => {
		globalThis.fetch = () =>
			Promise.resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array(64 * 1024));
							controller.enqueue(new Uint8Array([1]));
							controller.close();
						},
					}),
					{ status: 200 },
				),
			);
		return Effect.gen(function* () {
			const transport = yield* ShareTransport;
			const failure = yield* Effect.flip(transport.upload(new Uint8Array()));
			assert.equal(failure.code, "share_transport_failed");
		}).pipe(Effect.provide(ShareTransportLive));
	});
});

const fixtureKey = "AAAAAAAAAAAAAAAAAAAAAA";
const fixtureIv = Uint8Array.from({ length: 12 }, (_, index) => index);
const fixtureJson =
	'{"type":"excalidraw","version":2,"source":"fixture","elements":[],"appState":{}}';

// Recorded with Excalidraw compressData at the pinned baseline using the
// fixed key/IV above. This is an interoperability fixture, not regenerated by
// the implementation under test.
const upstreamFixtureBase64 =
	"AAAAAQAAADt7InZlcnNpb24iOjIsImNvbXByZXNzaW9uIjoicGFrb0AxIiwiZW5jcnlwdGlvbiI6IkFFUy1HQ00ifQAAAAwAAQIDBAUGBwgJCgsAAABwS0FmJqaMrQb1t7tGQcGwgA4SZcyKsmKKKAOPGVtpp3rmpxH09x+3tCmigYL0JVNUhroYaQnEUAQO3xrbxSLUOHzf1Dqd34h2udD2ajvavYTylPF0qu/YiNffWt3Et/n0vqmnXlUaNEWJ68C2UnYinw==";

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Runs the real opener path against a fake xdg-open that starts a grandchild. */
const openWithFakeOpener = (script: string) =>
	Effect.acquireUseRelease(
		Effect.promise(() => mkdtemp(join(tmpdir(), "sketchi-opener-"))),
		(directory) =>
			Effect.gen(function* () {
				const pidFile = join(directory, "grandchild.pid");
				const opener = join(directory, "xdg-open");
				yield* Effect.promise(() =>
					writeFile(opener, `#!/bin/sh\nsleep 30 & echo $! > ${pidFile}\n${script}\n`, {
						mode: 0o755,
					}),
				);
				// @effect-diagnostics-next-line processEnvInEffect:off -- The test sets or restores an endpoint override in the CLI’s actual host environment.
				const path = process.env["PATH"];
				// @effect-diagnostics-next-line processEnvInEffect:off -- The test sets or restores an endpoint override in the CLI’s actual host environment.
				process.env["PATH"] = `${directory}:${path ?? ""}`;
				const result = yield* Effect.gen(function* () {
					return yield* (yield* LinkOpener).open("https://excalidraw.com/#json=a,b");
				}).pipe(
					Effect.provide(
						makeLinkOpenerLayer("linux", 1_000).pipe(Layer.provide(NodeServices.layer)),
					),
					Effect.ensuring(
						Effect.sync(() => {
							// @effect-diagnostics-next-line processEnvInEffect:off -- The test sets or restores an endpoint override in the CLI’s actual host environment.
							process.env["PATH"] = path;
						}),
					),
				);
				const grandchild = Number(yield* Effect.promise(() => readFile(pidFile, "utf8")));
				const alive = processExists(grandchild);
				if (alive) process.kill(grandchild, "SIGKILL");
				return { result, alive };
			}),
		(directory) => Effect.promise(() => rm(directory, { force: true, recursive: true })),
	);

describe.skipIf(process.platform === "win32")("link opener processes", () => {
	it.live("terminates a hung opener's whole process tree at the timeout", () =>
		Effect.gen(function* () {
			const { result, alive } = yield* openWithFakeOpener("sleep 30");
			assert.deepEqual(result, { status: "unconfirmed", reason: "timeout" });
			assert.equal(alive, false);
		}),
	);

	it.live("leaves what a successful opener started running", () =>
		Effect.gen(function* () {
			const { result, alive } = yield* openWithFakeOpener("exit 0");
			assert.deepEqual(result, { status: "accepted" });
			assert.equal(alive, true);
		}),
	);
});

describe("Excalidraw share-link protocol", () => {
	it.effect("decrypts the recorded upstream format-v2 fixture", () =>
		Effect.gen(function* () {
			const decoded = yield* decodeSharePayload(
				Buffer.from(upstreamFixtureBase64, "base64"),
				fixtureKey,
			);
			// @effect-diagnostics-next-line globalJsonInEffect:off -- The test handles fixture JSON independently of the product codec.
			assert.deepEqual(decoded, JSON.parse(fixtureJson));
		}).pipe(Effect.provide(ShareCryptoLive)),
	);

	it.effect("encodes a format-v2 payload that round-trips", () =>
		Effect.gen(function* () {
			const encoded = yield* encodeSharePayload(
				new TextEncoder().encode(fixtureJson),
				fixtureKey,
				fixtureIv,
			);
			// @effect-diagnostics-next-line globalJsonInEffect:off -- The test handles fixture JSON independently of the product codec.
			assert.deepEqual(yield* decodeSharePayload(encoded, fixtureKey), JSON.parse(fixtureJson));
			assert.equal(Buffer.from(encoded).toString("base64"), upstreamFixtureBase64);
		}).pipe(Effect.provide(ShareCryptoLive)),
	);

	it.effect("rejects tampering without leaking key material", () =>
		Effect.gen(function* () {
			const body = Buffer.from(upstreamFixtureBase64, "base64");
			body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
			const failure = yield* Effect.flip(decodeSharePayload(body, fixtureKey).pipe(Effect.asVoid));
			assert.equal(failure.code, "share_crypto_failed");
			assert.equal(failure.message.includes(fixtureKey), false);
		}).pipe(Effect.provide(ShareCryptoLive)),
	);

	it.effect("parses only strict root Excalidraw share URLs", () =>
		Effect.gen(function* () {
			const expected = { id: "example_123", key: fixtureKey };
			assert.deepEqual(yield* parseShareLink(formatShareLink(expected)), expected);
			assert.deepEqual(
				yield* parseShareLink(`https://www.excalidraw.com/#json=${expected.id},${expected.key}`),
				expected,
			);
			for (const invalid of [
				`http://excalidraw.com/#json=${expected.id},${expected.key}`,
				`https://evil.invalid/#json=${expected.id},${expected.key}`,
				`https://EXCALIDRAW.com/#json=${expected.id},${expected.key}`,
				`https://user@excalidraw.com/#json=${expected.id},${expected.key}`,
				`https://excalidraw.com:443/#json=${expected.id},${expected.key}`,
				`https://excalidraw.com/path#json=${expected.id},${expected.key}`,
				`https://excalidraw.com/?x=1#json=${expected.id},${expected.key}`,
			]) {
				assert.equal((yield* Effect.flip(parseShareLink(invalid))).code, "invalid_share_link");
			}
		}),
	);

	it.effect("bounds compression before encryption and final framing", () =>
		Effect.gen(function* () {
			const oversized = new Uint8Array(3 * 1024 * 1024);
			let state = 0x12345678;
			for (let index = 0; index < oversized.byteLength; index += 1) {
				state ^= state << 13;
				state ^= state >>> 17;
				state ^= state << 5;
				oversized[index] = state & 0xff;
			}
			const failure = yield* Effect.flip(encodeSharePayload(oversized, "invalid-key", fixtureIv));
			assert.equal(failure.code, "share_payload_too_large");
		}).pipe(Effect.provide(ShareCryptoLive)),
	);
});
