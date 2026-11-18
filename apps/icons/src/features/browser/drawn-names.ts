// @effect-diagnostics strictEffectProvide:off -- Each browser preference read and write reacquires the native store, so a transient access denial cannot poison a retained runtime layer.
import { BrowserKeyValueStore, BrowserStream } from "@effect/platform-browser";
import { Cause, Effect, Option, Schema, SchemaGetter, Stream } from "effect";
import { KeyValueStore } from "effect/persistence";
import { AsyncResult, Atom } from "effect/reactivity";

export const DRAWN_NAMES_KEY = "sketchi-icons:drawn-names";
const RawChoice = Schema.Literals(["on", "off"]).pipe(
	Schema.decodeTo(Schema.Boolean, {
		decode: SchemaGetter.transform((raw) => raw === "on"),
		encode: SchemaGetter.transform((named) => (named ? "on" : "off")),
	}),
);
// BrowserKeyValueStore acquires localStorage in Layer.sync. Its getter can
// throw before the store's typed methods exist. These two native boundaries
// translate that acquisition failure and reacquire on each event/user action;
// a failed runtime layer is never cached for the rest of the page.
const readStored = Effect.flatMap(KeyValueStore.KeyValueStore, (store) =>
	store.get(DRAWN_NAMES_KEY),
).pipe(
	Effect.provide(BrowserKeyValueStore.layerLocalStorage),
	Effect.catchDefect((cause) =>
		Effect.fail(
			new KeyValueStore.KeyValueStoreError({
				key: DRAWN_NAMES_KEY,
				method: "get",
				message: "Unable to acquire the names preference store.",
				cause,
			}),
		),
	),
);
const writeStored = Effect.fn("Icons.names.persistRaw")((raw: string) =>
	Effect.flatMap(KeyValueStore.KeyValueStore, (store) => store.set(DRAWN_NAMES_KEY, raw)).pipe(
		Effect.provide(BrowserKeyValueStore.layerLocalStorage),
		Effect.catchDefect((cause) =>
			Effect.fail(
				new KeyValueStore.KeyValueStoreError({
					key: DRAWN_NAMES_KEY,
					method: "set",
					message: "Unable to acquire the names preference store.",
					cause,
				}),
			),
		),
	),
);
// AsyncResult owns the last choice and persistence error together. A failed write
// keeps that choice authoritative for this page, including after later writes.
const choice = Atom.make<AsyncResult.AsyncResult<boolean, KeyValueStore.KeyValueStoreError>>(
	AsyncResult.success(false),
).pipe(Atom.keepAlive);
function failedWrite(result: AsyncResult.AsyncResult<boolean, KeyValueStore.KeyValueStoreError>) {
	return (
		AsyncResult.isFailure(result) &&
		Option.exists(Cause.findErrorOption(result.cause), (error) => error.method === "set")
	);
}
const readChoice = Atom.make((get) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const read = Effect.fn("Icons.names.read")(function* () {
				if (failedWrite(get.registry.get(choice))) return;
				const result = yield* readStored.pipe(
					Effect.flatMap((raw) =>
						Schema.decodeUnknownEffect(RawChoice)(raw ?? "off").pipe(
							Effect.catchTag("SchemaError", () => Effect.succeed(false)),
						),
					),
					Effect.exit,
				);
				get.set(
					choice,
					AsyncResult.fromExitWithPrevious(result, Option.some(get.registry.get(choice))),
				);
			});
			return Stream.concat(
				Stream.fromEffect(read()),
				BrowserStream.fromEventListenerWindow("storage").pipe(
					Stream.filterEffect((event) =>
						Effect.try(
							() =>
								(event.key === null || event.key === DRAWN_NAMES_KEY) &&
								(event.storageArea === null || event.storageArea === globalThis.localStorage),
						).pipe(Effect.orElseSucceed(() => false)),
					),
					Stream.mapEffect(() => read()),
				),
			);
		}),
	),
).pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial);
const persist = Atom.fn(
	Effect.fn("Icons.names.write")(function* (named: boolean, get: Atom.FnContext) {
		const raw = yield* Schema.encodeEffect(RawChoice)(named);
		yield* writeStored(raw).pipe(
			Effect.catchTag("KeyValueStoreError", (error) =>
				Effect.sync(() => {
					get.set(
						choice,
						AsyncResult.failWithPrevious(error, {
							previous: Option.some(get.registry.get(choice)),
						}),
					);
				}),
			),
		);
	}),
);
export const drawnNames = Atom.writable(
	(get) => {
		get.mount(readChoice);
		get.mount(persist);
		return AsyncResult.getOrElse(get(choice), () => false);
	},
	(context, named: boolean) => {
		const previous = context.get(choice);
		const next = AsyncResult.success(named);
		context.set(
			choice,
			failedWrite(previous) && AsyncResult.isFailure(previous)
				? AsyncResult.failure(previous.cause, { previousSuccess: Option.some(next) })
				: next,
		);
		context.set(persist, named);
	},
).pipe(
	Atom.setIdleTTL(0),
	Atom.withServerValue(() => false),
);
