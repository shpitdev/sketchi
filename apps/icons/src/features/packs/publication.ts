import { Array, Effect, Schema, SchemaGetter, SchemaIssue, String } from "effect";

/**
 * Publishing a pack to Excalidraw's library collection: a visitor names
 * themselves as its author and the icons Worker sends the pack, as
 * excalidraw.com's "Publish library" dialog would, to the collection's
 * backend. That opens a pull request whose "Installation link" adds the
 * library on excalidraw.com without touching the canvas. Each pack version is
 * sent once.
 */

/** Where a pull request in Excalidraw's library collection stands, as GitHub last said. */
export type PullRequestState = "open" | "merged" | "closed";

export interface PackPullRequest {
	readonly url: string;
	/** Absent until GitHub has been read. */
	readonly state?: PullRequestState;
}

/** What the pages know about a pack on Excalidraw. */
export interface PackExcalidrawState {
	/** Adds the pack's newest library still in reach to someone's Excalidraw library. */
	readonly installUrl?: string;
	/** The newest submitted version's pull request. */
	readonly pullRequest?: PackPullRequest;
	/** Whether a visitor may submit the pack's current version. */
	readonly publishable: boolean;
}

export const AUTHOR_NAME_MAX_LENGTH = 60;
export const WEBSITE_MAX_LENGTH = 200;
/** X's own handle rule: 1 to 15 letters, digits or underscores. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
const X_HOSTS = new Set(
	Array.flatMap(["x.com", "twitter.com"], (host) => [host, `www.${host}`, `mobile.${host}`]),
);
/** X's own pages, whose paths look like a profile's. */
const X_PAGES = new Set([
	"account",
	"compose",
	"explore",
	"hashtag",
	"home",
	"i",
	"intent",
	"login",
	"logout",
	"messages",
	"notifications",
	"privacy",
	"search",
	"settings",
	"share",
	"signup",
	"tos",
]);
/** A publish request body is three short fields. */
export const PUBLISH_MAX_BODY_BYTES = 2048;

export type XHandleCheck =
	| { readonly ok: true; readonly handle: string }
	| { readonly ok: false; readonly message: string };

/**
 * An X handle as people paste it: `jane`, `@jane`, or a profile link such as
 * `https://x.com/jane` or `twitter.com/jane/`, read as the bare handle. Empty
 * input is no handle.
 */
export function parseXHandle(input: string): XHandleCheck {
	const value = String.trim(input);
	if (!value) return { ok: true, handle: "" };
	if (!/[/.:]/u.test(value)) {
		const handle = String.replace(/^@/u, "")(value);
		return X_HANDLE.test(handle)
			? { ok: true, handle }
			: { ok: false, message: "An X handle is 1 to 15 letters, digits or underscores." };
	}
	const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `https://${value}`);
	if (!url || !/^https?:$/u.test(url.protocol) || !X_HOSTS.has(url.hostname)) {
		return { ok: false, message: "Enter an X handle or a link to an X profile." };
	}
	const path = Array.filter(String.split("/")(url.pathname), (part) => part.length > 0);
	const handle = path.length === 1 ? path[0] : undefined;
	return handle && X_HANDLE.test(handle) && !X_PAGES.has(String.toLowerCase(handle))
		? { ok: true, handle }
		: { ok: false, message: "That X link is not a profile; use one like x.com/yourname." };
}

const XHandle = Schema.String.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transformEffect((input) => {
			const parsed = parseXHandle(input);
			return parsed.ok
				? Effect.succeed(parsed.handle)
				: Effect.fail(new SchemaIssue.InvalidValue({ message: parsed.message }, input));
		}),
		encode: SchemaGetter.transform((value) => value),
	}),
);
/** One payload codec for the native handler and generated client. Attribution is unverified. */
export const PublishPayload = Schema.Struct({
	authorName: Schema.Trim.check(
		Schema.makeFilter((value: string) =>
			!value
				? "Add your name."
				: // oxlint-disable-next-line no-control-regex -- Publication author names must refuse control characters.
					value.length > AUTHOR_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)
					? `Your name must be at most ${AUTHOR_NAME_MAX_LENGTH} characters on one line.`
					: undefined,
		),
	),
	xHandle: Schema.optionalKey(XHandle),
	website: Schema.optionalKey(
		Schema.Trim.pipe(
			Schema.decodeTo(Schema.String, {
				decode: SchemaGetter.transformEffect((value) => {
					if (!value) return Effect.succeed("");
					const url = URL.parse(value);
					return value.length <= WEBSITE_MAX_LENGTH && url?.protocol === "https:"
						? Effect.succeed(url.href)
						: Effect.fail(
								new SchemaIssue.InvalidValue(
									{
										message: `The website must be an https:// address of at most ${WEBSITE_MAX_LENGTH} characters.`,
									},
									value,
								),
							);
				}),
				encode: SchemaGetter.transform((value) => value),
			}),
		),
	),
});

export const PublishResult = Schema.Struct({
	pullRequestUrl: Schema.String,
	installUrl: Schema.optionalKey(Schema.String),
});
export interface PublishResult extends Schema.Schema.Type<typeof PublishResult> {}
