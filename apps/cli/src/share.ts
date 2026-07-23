import { spawn } from "node:child_process";

import { Context, Effect, Layer } from "effect";

import { CliShareError } from "./errors.js";
import {
  EXCALIDRAW_GET_ENDPOINT,
  EXCALIDRAW_POST_ENDPOINT,
  MAX_POST_RESPONSE_BYTES,
  MAX_SHARE_BODY_BYTES,
  OPENER_WAIT_MS,
  SHARE_BACKEND_TIMEOUT_MS,
  decodeSharePayload,
  encodeSharePayload,
  formatShareLink,
  generateShareKey,
  parseShareLink,
  serializeForShare,
} from "./share-protocol.js";

export interface OpenResult {
  readonly status: "not_requested" | "accepted" | "unconfirmed";
  readonly reason?: "missing_executable" | "nonzero_exit" | "timeout";
}

function shareFailure(
  code:
    | "share_transport_failed"
    | "share_timeout"
    | "share_api_changed"
    | "share_link_unavailable",
  message: string,
  hint: string,
) {
  return CliShareError.make({ code, message, hint, details: [] });
}

async function readBoundedBody(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error("response body exceeds limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("response body exceeds limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function timeoutFailure() {
  return shareFailure(
    "share_timeout",
    "The Excalidraw storage request timed out.",
    "Retry once. The unofficial third-party backend may be unavailable.",
  );
}

function transportFailure() {
  return shareFailure(
    "share_transport_failed",
    "The Excalidraw storage request failed.",
    "Retry once. The unofficial third-party backend may be unavailable.",
  );
}

async function requestWithTimeout<A>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<A>,
): Promise<A> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHARE_BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}

export class ShareTransport extends Context.Service<
  ShareTransport,
  {
    readonly upload: (body: Uint8Array) => Effect.Effect<string, CliShareError>;
    readonly download: (id: string) => Effect.Effect<Uint8Array, CliShareError>;
  }
>()("@sketchi/cli/ShareTransport") {}

export const ShareTransportLive = Layer.succeed(ShareTransport, {
  upload: (body) =>
    Effect.tryPromise({
      try: async () => {
        return await requestWithTimeout(
          EXCALIDRAW_POST_ENDPOINT,
          {
            method: "POST",
            body: Uint8Array.from(body),
          },
          async (response) => {
            const responseBody = await readBoundedBody(
              response,
              MAX_POST_RESPONSE_BYTES,
            );
            if (!response.ok) throw new Error("upload HTTP failure");
            const value: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(responseBody),
            );
            if (
              typeof value !== "object" ||
              value === null ||
              !("id" in value) ||
              typeof value.id !== "string" ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
              !("data" in value) ||
              value.data !== `${EXCALIDRAW_GET_ENDPOINT}${value.id}`
            ) {
              throw shareFailure(
                "share_api_changed",
                "The Excalidraw storage API returned an unexpected response.",
                "The unofficial API may have changed; update Sketchi compatibility before retrying.",
              );
            }
            return value.id;
          },
        );
      },
      catch: (cause) => {
        if (cause instanceof CliShareError) return cause;
        return cause instanceof DOMException && cause.name === "AbortError"
          ? timeoutFailure()
          : transportFailure();
      },
    }),
  download: (id) =>
    Effect.tryPromise({
      try: async () => {
        return await requestWithTimeout(
          `${EXCALIDRAW_GET_ENDPOINT}${id}`,
          { method: "GET" },
          async (response) => {
            if (response.status === 404) {
              throw shareFailure(
                "share_link_unavailable",
                "The Excalidraw share link is unavailable.",
                "Verify the complete bearer link or ask its sender to export a new link.",
              );
            }
            if (!response.ok) throw new Error("download HTTP failure");
            return await readBoundedBody(response, MAX_SHARE_BODY_BYTES);
          },
        );
      },
      catch: (cause) => {
        if (cause instanceof CliShareError) return cause;
        return cause instanceof DOMException && cause.name === "AbortError"
          ? timeoutFailure()
          : transportFailure();
      },
    }),
});

export class LinkOpener extends Context.Service<
  LinkOpener,
  { readonly open: (link: string) => Effect.Effect<OpenResult> }
>()("@sketchi/cli/LinkOpener") {}

interface OpenerChild {
  onError(listener: () => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): boolean;
}

type SpawnOpener = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly shell: false; readonly stdio: "ignore" },
) => OpenerChild;

function openerCommand(
  link: string,
  platform: NodeJS.Platform,
): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [link] };
    case "win32":
      return {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", "start", "", link],
      };
    default:
      return { command: "xdg-open", args: [link] };
  }
}

export function makeLinkOpenerLayer(
  spawnOpener: SpawnOpener = (command, args, options) => {
    const child = spawn(command, [...args], options);
    return {
      onError: (listener) => {
        child.once("error", listener);
      },
      onExit: (listener) => {
        child.once("exit", listener);
      },
      kill: () => child.kill(),
    };
  },
  platform: NodeJS.Platform = process.platform,
  waitMs: number = OPENER_WAIT_MS,
) {
  return Layer.succeed(LinkOpener, {
    open: (link) =>
      Effect.promise(
        () =>
          new Promise<OpenResult>((resolve) => {
            const target = openerCommand(link, platform);
            const child = spawnOpener(target.command, target.args, {
              shell: false,
              stdio: "ignore",
            });
            let settled = false;
            const complete = (result: OpenResult) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(result);
            };
            child.onError(() =>
              complete({ status: "unconfirmed", reason: "missing_executable" }),
            );
            child.onExit((code) =>
              complete(
                code === 0
                  ? { status: "accepted" }
                  : { status: "unconfirmed", reason: "nonzero_exit" },
              ),
            );
            const timer = setTimeout(() => {
              child.kill();
              complete({ status: "unconfirmed", reason: "timeout" });
            }, waitMs);
          }),
      ),
  });
}

export const LinkOpenerLive = makeLinkOpenerLayer();

export class ExcalidrawShare extends Context.Service<
  ExcalidrawShare,
  {
    readonly share: (
      artifact: unknown,
    ) => Effect.Effect<{ readonly link: string }, CliShareError>;
    readonly pull: (link: string) => Effect.Effect<unknown, CliShareError>;
  }
>()("@sketchi/cli/ExcalidrawShare") {}

export const ExcalidrawShareLive = Layer.effect(
  ExcalidrawShare,
  Effect.gen(function* () {
    const transport = yield* ShareTransport;
    const share = Effect.fn("sketchi.cli.share.upload")(function* (
      artifact: unknown,
    ) {
      const serialized = yield* serializeForShare(artifact);
      const key = generateShareKey();
      const body = yield* encodeSharePayload(serialized, key);
      const id = yield* transport.upload(body);
      return { link: formatShareLink({ id, key }) };
    });
    const pull = Effect.fn("sketchi.cli.share.pull")(function* (link: string) {
      const parts = yield* parseShareLink(link);
      const body = yield* transport.download(parts.id);
      return yield* decodeSharePayload(body, parts.key);
    });
    return { share, pull };
  }),
);
