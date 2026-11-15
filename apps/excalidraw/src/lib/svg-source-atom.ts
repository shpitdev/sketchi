import { Effect, Layer, Schema, Stream, String } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { Atom, AsyncResult } from "effect/reactivity";

class SvgSourceError extends Schema.TaggedError<
	SvgSourceError,
	{ readonly brand: unique symbol }
>()("SvgSourceError", {
	message: Schema.String,
	cause: Schema.optionalKey(Schema.Unknown),
}) {}

const MAX_SVG_BYTES = 1_000_000;
const oversized = () =>
	new SvgSourceError({ message: "Icon SVG exceeds the 1 MB workspace import limit." });

/** The application Registry owns the transport and each URL's request lifetime. */
export const svgHttpLayer = Atom.make<Layer.Layer<HttpClient.HttpClient>>(FetchHttpClient.layer);
const runtime = Atom.runtime((get) => get(svgHttpLayer));

const loadSource = Effect.fn("SvgWorkspace.loadSource")(
	function* (url: string) {
		const client = yield* HttpClient.HttpClient;
		const response = yield* HttpClient.withScope(client).get(url);
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new SvgSourceError({ message: `Icon SVG returned HTTP ${response.status}.` }),
			);
		}
		if (
			!String.startsWith("image/svg+xml")(
				String.toLowerCase(response.headers["content-type"] ?? ""),
			)
		) {
			return yield* Effect.fail(
				new SvgSourceError({ message: "Icon source did not return an SVG content type." }),
			);
		}
		if (Number(response.headers["content-length"]) > MAX_SVG_BYTES) {
			return yield* Effect.fail(oversized());
		}
		const bytes = response.stream.pipe(
			Stream.catchReason("HttpClientError", "EmptyBodyError", () => Stream.empty),
			Stream.mapError(
				(cause) => new SvgSourceError({ message: "The icon SVG could not be loaded.", cause }),
			),
		);
		return yield* bytes.pipe(
			Stream.limitBytes(MAX_SVG_BYTES, () => Stream.fail(oversized())),
			Stream.decodeText(),
			Stream.mkString,
		);
	},
	Effect.scoped,
	Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
	// Public SVG CORS allows simple GETs, not tracing headers. Keep the local spans.
	Effect.provideService(HttpClient.TracerPropagationEnabled, false),
	Effect.catchTag("HttpClientError", (cause) =>
		Effect.fail(
			new SvgSourceError({
				message: "The icon SVG could not be loaded.",
				cause,
			}),
		),
	),
);

// Fixtures skip even transport-layer acquisition. Server rendering never starts a query.
const initialSource = Atom.make(AsyncResult.success<string | undefined>(undefined));
export const svgSourceAtom = Atom.family(
	(
		url: string | undefined,
	): Atom.Atom<AsyncResult.AsyncResult<string | undefined, SvgSourceError>> =>
		url === undefined
			? initialSource
			: runtime.atom(loadSource(url)).pipe(Atom.setIdleTTL(0), Atom.withServerValueInitial),
);
