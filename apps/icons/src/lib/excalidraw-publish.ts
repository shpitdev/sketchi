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
/** Twitter's own handle rule: 1 to 15 letters, digits or underscores. */
const TWITTER_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;
/** A publish request body is three short fields. */
export const PUBLISH_MAX_BODY_BYTES = 2048;

export interface PublishAuthor {
	readonly authorName: string;
	readonly twitterHandle: string;
	readonly website: string;
}

export type PublishRequestCheck =
	| { readonly ok: true; readonly author: PublishAuthor }
	| { readonly ok: false; readonly message: string };

/**
 * The author fields a visitor sends: a name (required), a Twitter handle and
 * a website. No GitHub handle: the collection's bot mentions it on GitHub,
 * and nothing here can show the visitor owns it.
 */
export function checkPublishRequest(body: unknown, defaultWebsite: string): PublishRequestCheck {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false, message: "Send { authorName, twitterHandle?, website? }." };
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
	const twitterHandle = (text("twitterHandle") ?? "").replace(/^@/u, "");
	if (twitterHandle && !TWITTER_HANDLE.test(twitterHandle)) {
		return { ok: false, message: "A Twitter handle is up to 15 letters, digits or underscores." };
	}
	const website = text("website") || defaultWebsite;
	const url = URL.parse(website);
	if (website.length > WEBSITE_MAX_LENGTH || url?.protocol !== "https:") {
		return {
			ok: false,
			message: `The website must be an https:// address of at most ${WEBSITE_MAX_LENGTH} characters.`,
		};
	}
	return { ok: true, author: { authorName, twitterHandle, website: url.href } };
}

export function packPublishPath(id: string): string {
	return `/api/packs/${encodeURIComponent(id)}/excalidraw`;
}

export interface PublishResult {
	readonly pullRequestUrl: string;
	readonly installUrl?: string;
}
