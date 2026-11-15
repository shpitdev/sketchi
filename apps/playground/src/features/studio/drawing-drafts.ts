import {
	IndexedDb,
	IndexedDbDatabase,
	IndexedDbTable,
	IndexedDbVersion,
} from "@effect/platform-browser";
import { Effect, Layer, Stream } from "effect";
import { Atom } from "effect/reactivity";
import { StudioDrawing } from "../projects/contracts";

// Version 1, out-of-line keys, and structured drawing values are the deployed
// wire. The native table encodes the row without its out-of-line key.
const DrawingDrafts = IndexedDbTable.make({ name: "drawing-drafts", schema: StudioDrawing });
const DraftDatabase = IndexedDbDatabase.make(IndexedDbVersion.make(DrawingDrafts), (query) =>
	query.createObjectStore("drawing-drafts").pipe(Effect.asVoid),
);
const draftLayer = DraftDatabase.layer("sketchi-studio").pipe(Layer.provide(IndexedDb.layerWindow));

// Each operation owns acquisition and closure. Reacquisition allows later edits
// to recover after transient browser storage denial, without a failed-layer cache.
const bestEffort = <A, E>(effect: Effect.Effect<A, E, IndexedDbDatabase.IndexedDbDatabase>) =>
	// @effect-diagnostics-next-line strictEffectProvide:off -- Each best-effort browser draft operation owns fresh scoped acquisition, transaction completion and database closure, including recovery after storage denial.
	Effect.scoped(effect.pipe(Effect.provide(draftLayer))).pipe(
		Effect.orElseSucceed(() => undefined),
		Effect.catchDefect(() => Effect.succeed(undefined)),
	);

export const readDrawingDraft = (diagramId: string) =>
	bestEffort(
		Effect.gen(function* () {
			const query = yield* DraftDatabase;
			const row = yield* query
				.from("drawing-drafts")
				.select()
				.equals(`diagram:${diagramId}`)
				.first();
			const { key: _key, ...drawing } = row;
			return drawing;
		}),
	);

/** Native mutation replacement interrupts the preceding transaction. Clear uses
 * that same owner; withTransaction awaits commit instead of request success. */
export const drawingDraft = Atom.family((diagramId: string) =>
	Atom.fn((drawing: StudioDrawing | undefined) =>
		Stream.fromEffect(
			bestEffort(
				Effect.gen(function* () {
					const query = yield* DraftDatabase;
					const drafts = query.from("drawing-drafts");
					yield* (
						drawing === undefined
							? drafts.delete().equals(`diagram:${diagramId}`)
							: drafts.upsert({ ...drawing, key: `diagram:${diagramId}` })
					).pipe(query.withTransaction({ tables: ["drawing-drafts"], mode: "readwrite" }));
				}),
			),
		),
	).pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
