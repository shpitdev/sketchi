// Vitest browser provider that runs browser-mode suites in a Browserbase remote
// Chromium over CDP. No local browser binary is ever launched: the remote page
// reaches the local Vitest/Vite server through Playwright request and WebSocket
// routes that this Node process fulfills.
import { playwright, type PlaywrightProviderOptions } from "@vitest/browser-playwright";
import { type Browser, type BrowserContext, chromium, type WebSocketRoute } from "playwright";

const SESSIONS_API = "https://api.browserbase.com/v1/sessions";
// Seconds; long enough for the slowest suite plus Vite's first transform.
const SESSION_TIMEOUT = 900;

type PlaywrightProviderInternals = {
	browser: Browser | null;
	openBrowser(options: unknown): Promise<Browser>;
	createContext(sessionId: string, options: unknown): Promise<BrowserContext>;
};

async function connectBrowserbase(): Promise<Browser> {
	const apiKey = process.env["BROWSERBASE_API_KEY"];
	const projectId = process.env["BROWSERBASE_PROJECT_ID"];
	if (!apiKey || !projectId) {
		throw new Error(
			"test-browser suites run in a Browserbase remote browser. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.",
		);
	}
	const response = await fetch(SESSIONS_API, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
		body: JSON.stringify({ projectId, timeout: SESSION_TIMEOUT }),
	});
	if (!response.ok) {
		throw new Error(
			`Browserbase session creation failed with HTTP ${response.status}: ${await response.text()}`,
		);
	}
	const { connectUrl } = (await response.json()) as { connectUrl: string };
	return chromium.connectOverCDP(connectUrl);
}

const isLocalUrl = (url: URL) =>
	url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

// WebSocket codes that are reported but may not be sent in a close frame.
const reservedCloseCodes = new Set([1005, 1006, 1015]);

function proxyWebSocket(route: WebSocketRoute) {
	const upstream = new WebSocket(route.url());
	upstream.binaryType = "arraybuffer";
	const pending: Array<string | Uint8Array<ArrayBuffer>> = [];
	upstream.addEventListener("open", () => {
		for (const message of pending.splice(0)) {
			upstream.send(message);
		}
	});
	upstream.addEventListener("message", ({ data }) => {
		route.send(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer));
	});
	upstream.addEventListener("close", ({ code, reason }) => {
		void route.close(reservedCloseCodes.has(code) ? { reason } : { code, reason });
	});
	route.onMessage((message) => {
		const payload = typeof message === "string" ? message : Uint8Array.from(message);
		if (upstream.readyState === WebSocket.OPEN) {
			upstream.send(payload);
		} else {
			pending.push(payload);
		}
	});
	route.onClose(() => upstream.close());
}

async function proxyLocalTraffic(context: BrowserContext) {
	await context.route(isLocalUrl, async (route) => {
		await route.fulfill({ response: await route.fetch({ maxRedirects: 0 }) });
	});
	await context.routeWebSocket(isLocalUrl, proxyWebSocket);
}

export function browserbase(
	options: PlaywrightProviderOptions = {},
): ReturnType<typeof playwright> {
	const provider = playwright(options);
	return {
		...provider,
		// The default prewarm launches a local Chromium; the remote session starts on demand.
		prewarm() {},
		providerFactory(project) {
			const instance = provider.providerFactory(project);
			const internals = instance as unknown as PlaywrightProviderInternals;
			let connecting: Promise<Browser> | undefined;
			internals.openBrowser = () => {
				connecting ??= connectBrowserbase().then((browser) => {
					internals.browser = browser;
					return browser;
				});
				return connecting;
			};
			const proxied = new WeakSet<BrowserContext>();
			const createContext = internals.createContext.bind(instance);
			internals.createContext = async (sessionId, contextOptions) => {
				const context = await createContext(sessionId, contextOptions);
				if (!proxied.has(context)) {
					proxied.add(context);
					await proxyLocalTraffic(context);
				}
				return context;
			};
			return instance;
		},
	};
}
