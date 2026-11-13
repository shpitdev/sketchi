/**
 * Publishing a pack to Excalidraw's library collection: a visitor names
 * themselves as its author and the icons Worker sends the pack, as
 * excalidraw.com's "Publish library" dialog would, to the collection's
 * backend. That opens a pull request whose "Installation link" adds the
 * library on excalidraw.com without touching the canvas. Each pack version is
 * sent once.
 */

/** What the pages know about a pack on Excalidraw. */
export interface PackExcalidrawState {
	/** Adds the pack's latest submitted version to someone's Excalidraw library. */
	readonly installUrl?: string;
	/** Whether a visitor may submit the pack's current version. */
	readonly publishable: boolean;
}

export const AUTHOR_NAME_MAX_LENGTH = 60;
export const WEBSITE_MAX_LENGTH = 200;
/** X's own handle rule: 1 to 15 letters, digits or underscores. */
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
const X_HOSTS = new Set(
	["x.com", "twitter.com"].flatMap((host) => [host, `www.${host}`, `mobile.${host}`]),
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
	const value = input.trim();
	if (!value) return { ok: true, handle: "" };
	if (!/[/.:]/u.test(value)) {
		const handle = value.replace(/^@/u, "");
		return X_HANDLE.test(handle)
			? { ok: true, handle }
			: { ok: false, message: "An X handle is 1 to 15 letters, digits or underscores." };
	}
	const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `https://${value}`);
	if (!url || !/^https?:$/u.test(url.protocol) || !X_HOSTS.has(url.hostname)) {
		return { ok: false, message: "Enter an X handle or a link to an X profile." };
	}
	const path = url.pathname.split("/").filter(Boolean);
	const handle = path.length === 1 ? path[0] : undefined;
	return handle && X_HANDLE.test(handle) && !X_PAGES.has(handle.toLowerCase())
		? { ok: true, handle }
		: { ok: false, message: "That X link is not a profile; use one like x.com/yourname." };
}

export interface PublishAuthor {
	readonly authorName: string;
	readonly xHandle: string;
	readonly website: string;
}

export type PublishRequestCheck =
	| { readonly ok: true; readonly author: PublishAuthor }
	| { readonly ok: false; readonly message: string };

/**
 * The author fields a visitor sends: a name (required), an X handle and a
 * website. No GitHub handle: the collection's bot mentions it on GitHub,
 * and nothing here can show the visitor owns it.
 */
export function checkPublishRequest(body: unknown, defaultWebsite: string): PublishRequestCheck {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false, message: "Send { authorName, xHandle?, website? }." };
	}
	const fields = body as Record<string, unknown>;
	const text = (key: string) => (typeof fields[key] === "string" ? fields[key].trim() : undefined);
	const authorName = text("authorName");
	if (!authorName) return { ok: false, message: "Add your name." };
	// oxlint-disable-next-line no-control-regex -- control characters are what this refuses
	if (authorName.length > AUTHOR_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/u.test(authorName)) {
		return {
			ok: false,
			message: `Your name must be at most ${AUTHOR_NAME_MAX_LENGTH} characters on one line.`,
		};
	}
	const xHandle = parseXHandle(text("xHandle") ?? "");
	if (!xHandle.ok) return xHandle;
	const website = text("website") || defaultWebsite;
	const url = URL.parse(website);
	if (website.length > WEBSITE_MAX_LENGTH || url?.protocol !== "https:") {
		return {
			ok: false,
			message: `The website must be an https:// address of at most ${WEBSITE_MAX_LENGTH} characters.`,
		};
	}
	return { ok: true, author: { authorName, xHandle: xHandle.handle, website: url.href } };
}

export function packPublishPath(id: string): string {
	return `/api/packs/${encodeURIComponent(id)}/excalidraw`;
}

export interface PublishResult {
	readonly pullRequestUrl: string;
	readonly installUrl?: string;
}
