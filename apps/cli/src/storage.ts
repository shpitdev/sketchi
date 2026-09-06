import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { inflateSync } from "node:zlib";

import {
  ExcalidrawFileSchema,
  RenderedDiagramSceneSchema,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer, Schedule, Schema } from "effect";

import {
  DOCUMENT_FILE,
  DiagramRecordManifest,
  EXCALIDRAW_FILE,
  MANIFEST_FILE,
  PNG_FILE,
  RECORD_SCHEMA_VERSION,
  REVISIONS_DIRECTORY,
  SCENE_FILE,
  type BuiltDiagram,
  type DiagramFormat,
  type DiagramSummary,
  type PatchedDiagramArtifacts,
  type PatchSource,
  type StoredDiagram,
  revisionFileName,
  revisionDirectoryName,
  summaryFromStored,
} from "./contracts.js";
import {
  type CanonicalDiagramDocument,
  decodeCanonicalDiagramDocument,
  decodeStoredDiagramDocument,
  encodeJson,
} from "./document.js";
import {
  CliExportError,
  CliFilesystemError,
  CliStorageError,
} from "./errors.js";
import { LocalFileSystem, type LocalEntry } from "./filesystem.js";
import {
  MAX_DECOMPRESSED_BYTES,
  validateShareScene,
} from "./share-protocol.js";

export class StorageRoot extends Context.Service<
  StorageRoot,
  { readonly path: string }
>()("@sketchi/cli/StorageRoot") {}

export type ExportSource =
  | { readonly _tag: "StoredArtifact"; readonly bytes: Uint8Array }
  | {
      readonly _tag: "RenderPng";
      readonly scene?: Uint8Array;
      readonly excalidraw: Uint8Array;
    };

export type RevisionSource =
  | {
      readonly _tag: "LegacyDocument";
      readonly revision: number;
      readonly document: CanonicalDiagramDocument;
    }
  | { readonly _tag: "FullSnapshot"; readonly revision: number };

export interface RestoreResult {
  readonly diagram: StoredDiagram;
  readonly restoredFromRevision: number;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function concatenateBytes(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const byteLength = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

function passExtent(size: number, start: number, step: number): number {
  return size <= start ? 0 : Math.ceil((size - start) / step);
}

function pngScanlines(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlace: number,
): ReadonlyArray<{ readonly rows: number; readonly rowBytes: number }> | null {
  const passes = interlace === 0 ? ([[0, 0, 1, 1]] as const) : ADAM7_PASSES;
  const scanlines: Array<{ readonly rows: number; readonly rowBytes: number }> =
    [];
  let totalBytes = 0;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = passExtent(width, xStart, xStep);
    const rows = passExtent(height, yStart, yStep);
    if (passWidth === 0 || rows === 0) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8) + 1;
    if (
      rowBytes > MAX_DECOMPRESSED_BYTES - totalBytes ||
      rows > Math.floor((MAX_DECOMPRESSED_BYTES - totalBytes) / rowBytes)
    ) {
      return null;
    }
    totalBytes += rows * rowBytes;
    scanlines.push({ rows, rowBytes });
  }
  return scanlines;
}

function hasValidInflatedPngData(
  chunks: ReadonlyArray<Uint8Array>,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
): boolean {
  const samplesPerPixel: Readonly<Record<number, number>> = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4,
  };
  const samples = samplesPerPixel[colorType];
  if (samples === undefined) return false;
  const scanlines = pngScanlines(width, height, samples * bitDepth, interlace);
  if (scanlines === null) return false;
  const expectedLength = scanlines.reduce(
    (total, pass) => total + pass.rows * pass.rowBytes,
    0,
  );
  try {
    const compressed = concatenateBytes(chunks);
    const result = inflateSync(compressed, {
      info: true,
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    }) as unknown as {
      readonly buffer: Uint8Array;
      readonly engine: { readonly bytesWritten: number };
    };
    if (result.engine.bytesWritten !== compressed.byteLength) return false;
    const inflated = result.buffer;
    if (inflated.byteLength !== expectedLength) return false;
    let offset = 0;
    for (const pass of scanlines) {
      for (let row = 0; row < pass.rows; row += 1) {
        if ((inflated[offset] ?? 5) > 4) return false;
        offset += pass.rowBytes;
      }
    }
    return offset === inflated.byteLength;
  } catch {
    return false;
  }
}

function isValidPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < 33 ||
    signature.some((byte, index) => bytes[index] !== byte)
  ) {
    return false;
  }
  let offset = signature.length;
  let chunkIndex = 0;
  let width: number | undefined;
  let height: number | undefined;
  let colorType: number | undefined;
  let bitDepth: number | undefined;
  let interlace: number | undefined;
  let seenPalette = false;
  let seenImageData = false;
  let imageDataEnded = false;
  const imageDataChunks: Uint8Array[] = [];
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.byteLength) return false;
    const typeStart = offset + 4;
    const typeBytes = bytes.subarray(typeStart, typeStart + 4);
    const isAsciiLetter = (byte: number): boolean =>
      (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    if (
      typeBytes.byteLength !== 4 ||
      !typeBytes.every(isAsciiLetter) ||
      (typeBytes[2]! & 0x20) !== 0
    ) {
      return false;
    }
    const type = String.fromCharCode(...typeBytes);
    if (chunkIndex === 0 && (type !== "IHDR" || length !== 13)) return false;
    if (type === "IHDR") {
      if (chunkIndex !== 0 || length !== 13) return false;
      width = readUint32(bytes, offset + 8);
      height = readUint32(bytes, offset + 12);
      bitDepth = bytes[offset + 16];
      colorType = bytes[offset + 17];
      interlace = bytes[offset + 20];
      const legalDepths: Readonly<Record<number, ReadonlyArray<number>>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width === 0 ||
        height === 0 ||
        width > 0x7fffffff ||
        height > 0x7fffffff ||
        colorType === undefined ||
        bitDepth === undefined ||
        !legalDepths[colorType]?.includes(bitDepth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        ![0, 1].includes(interlace ?? -1)
      ) {
        return false;
      }
    } else if (type === "PLTE") {
      if (
        seenPalette ||
        seenImageData ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 768 ||
        colorType === 0 ||
        colorType === 4 ||
        (colorType === 3 &&
          bitDepth !== undefined &&
          length / 3 > 2 ** bitDepth)
      ) {
        return false;
      }
      seenPalette = true;
    } else if (type === "IDAT") {
      if (imageDataEnded || (colorType === 3 && !seenPalette)) return false;
      seenImageData = true;
      imageDataChunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    } else if (type === "IEND") {
      if (length !== 0 || !seenImageData || (colorType === 3 && !seenPalette)) {
        return false;
      }
    } else {
      if (seenImageData) imageDataEnded = true;
      const firstTypeByte = bytes[typeStart];
      if (firstTypeByte === undefined || (firstTypeByte & 0x20) === 0) {
        return false;
      }
    }
    const expectedCrc = readUint32(bytes, offset + 8 + length);
    if (crc32(bytes.subarray(typeStart, offset + 8 + length)) !== expectedCrc) {
      return false;
    }
    offset = chunkEnd;
    chunkIndex += 1;
    if (type === "IEND") {
      return (
        offset === bytes.byteLength &&
        width !== undefined &&
        height !== undefined &&
        bitDepth !== undefined &&
        colorType !== undefined &&
        interlace !== undefined &&
        hasValidInflatedPngData(
          imageDataChunks,
          width,
          height,
          bitDepth,
          colorType,
          interlace,
        )
      );
    }
  }
  return false;
}

export class DiagramStore extends Context.Service<
  DiagramStore,
  {
    readonly create: (
      diagram: BuiltDiagram,
    ) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
    readonly edit: (
      diagramId: string,
      diagram: BuiltDiagram,
    ) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
    readonly readPatchSource: (
      diagramId: string,
    ) => Effect.Effect<PatchSource, CliFilesystemError | CliStorageError>;
    readonly commitPatch: (
      diagramId: string,
      expectedRevision: number,
      artifacts: PatchedDiagramArtifacts,
    ) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
    readonly replaceWithDetached: (
      diagramId: string,
      excalidraw: Uint8Array,
      expectedRevision?: number,
    ) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
    readonly readRevision: (
      diagramId: string,
      revision: number,
    ) => Effect.Effect<RevisionSource, CliFilesystemError | CliStorageError>;
    readonly restore: (
      diagramId: string,
      revision: number,
      legacyDiagram?: BuiltDiagram,
    ) => Effect.Effect<RestoreResult, CliFilesystemError | CliStorageError>;
    readonly show: (
      diagramId: string,
    ) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
    readonly list: () => Effect.Effect<
      ReadonlyArray<DiagramSummary>,
      CliFilesystemError | CliStorageError
    >;
    readonly readExportSource: (
      diagramId: string,
      format: DiagramFormat,
    ) => Effect.Effect<
      ExportSource,
      CliExportError | CliFilesystemError | CliStorageError
    >;
  }
>()("@sketchi/cli/DiagramStore") {}

const LOCKS_DIRECTORY = ".locks";
const LOCK_FREE_PREFIX = "free.";
const LOCK_OWNER_PREFIX = "owner.";
const LOCK_OWNER_CANDIDATE_PREFIX = ".owner-candidate.";
const LOCK_ENTRY_SUFFIX = ".json";
const LOCK_RECOVERY_TOKEN = "recovery";
const LOCK_INIT_PREFIX = ".init.";
const BACKUP_PREFIX = ".backup.";
const STAGE_PREFIX = `.stage.${String(process.pid)}.`;
const READ_LOCK_RETRY_DELAY = "10 millis";
const READ_LOCK_RETRY_LIMIT = 50;
const READ_LOCK_RETRY_POLICY = Schedule.spaced(READ_LOCK_RETRY_DELAY).pipe(
  Schedule.upTo({ times: READ_LOCK_RETRY_LIMIT }),
);

export const StorageRootLive = Layer.succeed(StorageRoot, {
  path: join(homedir(), ".sketchi", "diagrams"),
});

export function makeStorageRootLayer(path: string) {
  return Layer.succeed(StorageRoot, { path });
}

function storageError(
  code: CliStorageError["code"],
  message: string,
  hint: string,
  diagramId?: string,
) {
  return CliStorageError.make({
    code,
    message,
    hint,
    ...(diagramId ? { diagramId } : {}),
  });
}

function encodedId(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

function decodedId(value: string): string | undefined {
  try {
    const id = Buffer.from(value, "base64url").toString("utf8");
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRevisionEntries(left: string, right: string): number {
  const leftDigits = left.replace(/(?:\/|\.json)$/u, "").replace(/^0+/u, "");
  const rightDigits = right.replace(/(?:\/|\.json)$/u, "").replace(/^0+/u, "");
  const lengthComparison = leftDigits.length - rightDigits.length;
  return lengthComparison !== 0
    ? lengthComparison
    : compareCodeUnits(leftDigits, rightDigits) ||
        compareCodeUnits(left, right);
}

function replaceManifestRevision(
  source: string,
  revision: number,
): string | undefined {
  let depth = 0;
  let replacementStart = -1;
  let replacementEnd = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (character !== '"') continue;

    const stringStart = index;
    let escaped = false;
    for (index += 1; index < source.length; index += 1) {
      const stringCharacter = source[index];
      if (escaped) {
        escaped = false;
      } else if (stringCharacter === "\\") {
        escaped = true;
      } else if (stringCharacter === '"') {
        break;
      }
    }
    if (index >= source.length || depth !== 1) continue;

    let key: unknown;
    try {
      key = JSON.parse(source.slice(stringStart, index + 1));
    } catch {
      return undefined;
    }
    if (key !== "revision") continue;

    let cursor = index + 1;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== ":") continue;
    cursor += 1;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    const match = /^-?\d+/u.exec(source.slice(cursor));
    if (!match) return undefined;
    const end = cursor + match[0].length;
    let delimiter = end;
    while (/\s/u.test(source[delimiter] ?? "")) delimiter += 1;
    if (source[delimiter] !== "," && source[delimiter] !== "}") {
      return undefined;
    }
    if (replacementStart !== -1) return undefined;
    replacementStart = cursor;
    replacementEnd = end;
  }

  return replacementStart === -1
    ? undefined
    : `${source.slice(0, replacementStart)}${String(revision)}${source.slice(replacementEnd)}`;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "EPERM"
    );
  }
}

function filesystemErrorHasCode(
  error: CliFilesystemError,
  code: string,
): boolean {
  return (
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === code
  );
}

function transactionPid(name: string): number | undefined {
  const parts = name.split(".");
  const candidate = Number(parts.at(-2));
  return Number.isSafeInteger(candidate) ? candidate : undefined;
}

function lockOwner(
  text: string,
): { readonly pid: number; readonly token: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      typeof parsed.pid === "number" &&
      "token" in parsed &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
      ? { pid: parsed.pid, token: parsed.token }
      : undefined;
  } catch {
    return undefined;
  }
}

function lockFreeEntry(name: string):
  | {
      readonly token: string;
      readonly releasedOwnerToken?: string;
    }
  | undefined {
  if (!name.startsWith(LOCK_FREE_PREFIX) || !name.endsWith(LOCK_ENTRY_SUFFIX)) {
    return undefined;
  }
  const parts = name
    .slice(LOCK_FREE_PREFIX.length, -LOCK_ENTRY_SUFFIX.length)
    .split(".");
  if (
    (parts.length !== 1 && parts.length !== 2) ||
    parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))
  ) {
    return undefined;
  }
  const [token, releasedOwnerToken] = parts;
  if (!token) return undefined;
  return {
    token,
    ...(releasedOwnerToken ? { releasedOwnerToken } : {}),
  };
}

function lockOwnerCandidateToken(name: string): string | undefined {
  if (
    !name.startsWith(LOCK_OWNER_CANDIDATE_PREFIX) ||
    !name.endsWith(LOCK_ENTRY_SUFFIX)
  ) {
    return undefined;
  }
  const token = name.slice(
    LOCK_OWNER_CANDIDATE_PREFIX.length,
    -LOCK_ENTRY_SUFFIX.length,
  );
  return /^[a-zA-Z0-9_-]+$/.test(token) ? token : undefined;
}

interface LockHandle {
  readonly directory: string;
  readonly ownerPath: string;
  readonly token: string;
}

interface LockEntry {
  readonly name: string;
  readonly path: string;
  readonly state: "free" | "unpublished-owner" | "stale-owner" | "live-owner";
  readonly token: string;
  readonly releasedOwnerToken?: string;
}

function recordPath(root: string, diagramId: string): string {
  return join(root, diagramId);
}

function artifactFile(format: DiagramFormat): string {
  switch (format) {
    case "scene":
      return SCENE_FILE;
    case "excalidraw":
      return EXCALIDRAW_FILE;
    case "png":
      return PNG_FILE;
  }
}

function isVisibleRecord(entry: LocalEntry): boolean {
  return entry.kind === "directory" && !entry.name.startsWith(".");
}

function unsafeEntry(path: string, diagramId?: string) {
  return storageError(
    "unsafe_storage_entry",
    `Unsafe local storage entry at ${path}.`,
    "Replace symbolic links or special files with ordinary Sketchi record files.",
    diagramId,
  );
}

const DiagramStoreLive = Layer.effect(
  DiagramStore,
  Effect.gen(function* () {
    const fs = yield* LocalFileSystem;
    const root = yield* StorageRoot;

    const ensureOwnedDirectory = Effect.fn(
      "sketchi.cli.storage.ensureOwnedDirectory",
    )(function* (path: string) {
      let kind = yield* fs.kind(path);
      if (kind === "missing") {
        yield* fs
          .makeDirectory(path)
          .pipe(
            Effect.catch((error) =>
              filesystemErrorHasCode(error, "EEXIST")
                ? Effect.void
                : Effect.fail(error),
            ),
          );
        kind = yield* fs.kind(path);
      }
      if (kind !== "directory") return yield* unsafeEntry(path);
    });

    const ensureRoot = Effect.fn("sketchi.cli.storage.ensureRoot")(
      function* () {
        yield* ensureOwnedDirectory(dirname(root.path));
        yield* ensureOwnedDirectory(root.path);
        yield* ensureOwnedDirectory(join(root.path, LOCKS_DIRECTORY));
      },
    );

    const assertSafeTree: (
      path: string,
      diagramId?: string,
    ) => Effect.Effect<void, CliFilesystemError | CliStorageError> = Effect.fn(
      "sketchi.cli.storage.assertSafeTree",
    )(function* (path: string, diagramId?: string) {
      const entries = yield* fs.list(path);
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.kind === "symbolic-link" || entry.kind === "other") {
          return yield* unsafeEntry(child, diagramId);
        }
        if (entry.kind === "directory") {
          yield* assertSafeTree(child, diagramId);
        }
      }
    });

    const recoverStages = Effect.fn("sketchi.cli.storage.recoverStages")(
      function* () {
        yield* ensureRoot();
        const entries = [...(yield* fs.list(root.path))].sort((left, right) =>
          compareCodeUnits(left.name, right.name),
        );
        for (const entry of entries) {
          if (!entry.name.startsWith(".stage.")) continue;
          const pid = transactionPid(entry.name);
          if (pid === undefined || !processIsAlive(pid)) {
            yield* fs.remove(join(root.path, entry.name));
          }
        }
      },
    );

    const recoverRecordTransactions = Effect.fn(
      "sketchi.cli.storage.recoverRecordTransactions",
    )(function* (diagramId: string) {
      yield* ensureRoot();
      yield* recoverStages();
      const backupPrefix = `${BACKUP_PREFIX}${encodedId(diagramId)}.`;
      const entries = [...(yield* fs.list(root.path))]
        .filter((entry) => entry.name.startsWith(backupPrefix))
        .sort((left, right) => compareCodeUnits(left.name, right.name));
      for (const entry of entries) {
        const path = join(root.path, entry.name);
        const current = recordPath(root.path, diagramId);
        const currentKind = yield* fs.kind(current);
        if (currentKind === "missing") yield* fs.rename(path, current);
        else yield* fs.remove(path);
      }
    });

    const lockDirectory = (diagramId: string) =>
      join(root.path, LOCKS_DIRECTORY, `${encodedId(diagramId)}.lock`);

    const initializeLockDirectory = Effect.fn(
      "sketchi.cli.storage.initializeLockDirectory",
    )(function* (diagramId: string) {
      const directory = lockDirectory(diagramId);
      const existing = yield* fs.kind(directory);
      if (existing === "directory") return directory;
      if (existing !== "missing")
        return yield* unsafeEntry(directory, diagramId);

      const parent = join(root.path, LOCKS_DIRECTORY);
      return yield* Effect.acquireUseRelease(
        fs.makeTempDirectory(
          parent,
          `${LOCK_INIT_PREFIX}${encodedId(diagramId)}.`,
        ),
        (candidate) =>
          Effect.gen(function* () {
            const token = crypto.randomUUID();
            yield* fs.writeText(
              join(
                candidate,
                `${LOCK_FREE_PREFIX}${token}${LOCK_ENTRY_SUFFIX}`,
              ),
              encodeJson({ token }),
            );
            const installed = yield* fs.tryRenameDirectory(
              candidate,
              directory,
            );
            if (!installed) {
              const kind = yield* fs.kind(directory);
              if (kind !== "directory") {
                return yield* unsafeEntry(directory, diagramId);
              }
            }
            return directory;
          }),
        (candidate) => fs.remove(candidate),
      );
    });

    const busyError = (diagramId: string) =>
      storageError(
        "diagram_busy",
        `Diagram "${diagramId}" is being changed by another Sketchi process.`,
        "Wait for that command to finish, then retry.",
        diagramId,
      );

    const readLockEntries = Effect.fn("sketchi.cli.storage.readLockEntries")(
      function* (directory: string, diagramId: string) {
        const entries = [...(yield* fs.list(directory))].sort((left, right) =>
          compareCodeUnits(left.name, right.name),
        );
        const states: LockEntry[] = [];
        for (const entry of entries) {
          const path = join(directory, entry.name);
          if (entry.kind !== "file") return yield* unsafeEntry(path, diagramId);
          const free = lockFreeEntry(entry.name);
          if (free) {
            states.push({
              name: entry.name,
              path,
              state: "free",
              token: free.token,
              ...(free.releasedOwnerToken
                ? { releasedOwnerToken: free.releasedOwnerToken }
                : {}),
            });
            continue;
          }
          if (entry.name.startsWith(LOCK_FREE_PREFIX)) {
            return yield* unsafeEntry(path, diagramId);
          }
          const candidateToken = lockOwnerCandidateToken(entry.name);
          if (candidateToken) {
            states.push({
              name: entry.name,
              path,
              state: "unpublished-owner",
              token: candidateToken,
            });
            continue;
          }
          if (entry.name.startsWith(LOCK_OWNER_CANDIDATE_PREFIX)) {
            return yield* unsafeEntry(path, diagramId);
          }
          if (
            !entry.name.startsWith(LOCK_OWNER_PREFIX) ||
            !entry.name.endsWith(LOCK_ENTRY_SUFFIX)
          ) {
            return yield* unsafeEntry(path, diagramId);
          }
          const text = yield* fs
            .readText(path)
            .pipe(
              Effect.mapError((error) =>
                filesystemErrorHasCode(error, "ENOENT")
                  ? busyError(diagramId)
                  : error,
              ),
            );
          const owner = lockOwner(text);
          if (!owner) return yield* busyError(diagramId);
          if (
            entry.name !==
            `${LOCK_OWNER_PREFIX}${owner.token}${LOCK_ENTRY_SUFFIX}`
          ) {
            return yield* unsafeEntry(path, diagramId);
          }
          states.push({
            name: entry.name,
            path,
            token: owner.token,
            state: processIsAlive(owner.pid) ? "live-owner" : "stale-owner",
          });
        }
        return states;
      },
    );

    const acquireLockOnce: (
      diagramId: string,
    ) => Effect.Effect<LockHandle, CliFilesystemError | CliStorageError> =
      Effect.fn("sketchi.cli.storage.acquireLockOnce")(function* (
        diagramId: string,
      ) {
        yield* ensureRoot();
        const directory = yield* initializeLockDirectory(diagramId);
        const snapshot = yield* readLockEntries(directory, diagramId);
        const releasedOwnerTokens = new Set(
          snapshot.flatMap((entry) =>
            entry.releasedOwnerToken ? [entry.releasedOwnerToken] : [],
          ),
        );
        if (
          snapshot.some(
            (entry) =>
              entry.state === "live-owner" &&
              !releasedOwnerTokens.has(entry.token),
          )
        ) {
          return yield* busyError(diagramId);
        }
        let target =
          snapshot.find((entry) => entry.state === "free") ??
          snapshot.find((entry) => entry.state === "stale-owner");
        if (!target) {
          const recoveryPath = join(
            directory,
            `${LOCK_FREE_PREFIX}${LOCK_RECOVERY_TOKEN}${LOCK_ENTRY_SUFFIX}`,
          );
          const recovered = yield* fs.tryWriteText(
            recoveryPath,
            encodeJson({ token: LOCK_RECOVERY_TOKEN }),
          );
          if (!recovered) return yield* busyError(diagramId);
          target = {
            name: `${LOCK_FREE_PREFIX}${LOCK_RECOVERY_TOKEN}${LOCK_ENTRY_SUFFIX}`,
            path: recoveryPath,
            state: "free",
            token: LOCK_RECOVERY_TOKEN,
          };
        }

        const token = crypto.randomUUID();
        const ownerPath = join(
          directory,
          `${LOCK_OWNER_PREFIX}${token}${LOCK_ENTRY_SUFFIX}`,
        );
        const candidatePath = join(
          directory,
          `${LOCK_OWNER_CANDIDATE_PREFIX}${token}${LOCK_ENTRY_SUFFIX}`,
        );
        return yield* Effect.uninterruptible(
          Effect.acquireUseRelease(
            Effect.succeed(candidatePath),
            () =>
              Effect.gen(function* () {
                yield* fs.writeText(
                  candidatePath,
                  encodeJson({ pid: process.pid, token }),
                );
                const published = yield* fs.tryLinkFile(
                  candidatePath,
                  ownerPath,
                );
                if (!published) return yield* busyError(diagramId);

                const acquired = yield* fs
                  .removeFile(target.path)
                  .pipe(
                    Effect.catch((error) =>
                      fs
                        .removeFile(ownerPath)
                        .pipe(Effect.andThen(Effect.fail(error))),
                    ),
                  );
                if (!acquired) {
                  yield* fs.removeFile(ownerPath);
                  return yield* busyError(diagramId);
                }
                for (const entry of snapshot) {
                  if (entry.path === target.path) continue;
                  yield* fs
                    .removeFile(entry.path)
                    .pipe(Effect.catch(() => Effect.void));
                }
                return { directory, ownerPath, token } satisfies LockHandle;
              }),
            (path) => fs.removeFile(path).pipe(Effect.catch(() => Effect.void)),
          ),
        );
      });

    const acquireLock = (
      diagramId: string,
      waitForWriter: boolean,
    ): Effect.Effect<LockHandle, CliFilesystemError | CliStorageError> => {
      const attempt = acquireLockOnce(diagramId);
      return waitForWriter
        ? attempt.pipe(
            Effect.retry({
              schedule: READ_LOCK_RETRY_POLICY,
              while: (error) =>
                error._tag === "CliStorageError" &&
                error.code === "diagram_busy",
            }),
          )
        : attempt;
    };

    const releaseLock = Effect.fn("sketchi.cli.storage.releaseLock")(function* (
      diagramId: string,
      lock: LockHandle,
    ) {
      const token = crypto.randomUUID();
      const freePath = join(
        lock.directory,
        `${LOCK_FREE_PREFIX}${token}.${lock.token}${LOCK_ENTRY_SUFFIX}`,
      );
      const marker = encodeJson({
        token,
        releasedOwnerToken: lock.token,
      });
      const markerInstalled = yield* fs.writeText(freePath, marker).pipe(
        Effect.as(true),
        Effect.catch(() =>
          fs.tryWriteText(freePath, marker).pipe(
            Effect.flatMap((written) =>
              written
                ? Effect.succeed(true)
                : fs.kind(freePath).pipe(Effect.map((kind) => kind === "file")),
            ),
            Effect.catch(() => Effect.succeed(false)),
          ),
        ),
      );
      if (!markerInstalled) {
        const released = yield* fs.removeFile(lock.ownerPath);
        if (released) return;
        return yield* storageError(
          "storage_commit_failed",
          `Diagram "${diagramId}" lock ownership changed before release.`,
          "Retry after the active Sketchi command finishes.",
          diagramId,
        );
      }

      const releaseRecoverable = yield* fs.removeFile(lock.ownerPath).pipe(
        Effect.match({
          onFailure: () => true,
          onSuccess: (removed) => removed,
        }),
      );
      if (releaseRecoverable) return;
      yield* fs.removeFile(freePath).pipe(Effect.catch(() => Effect.void));
      return yield* storageError(
        "storage_commit_failed",
        `Diagram "${diagramId}" lock ownership changed before release.`,
        "Retry after the active Sketchi command finishes.",
        diagramId,
      );
    });

    const withLock = <A, E>(
      diagramId: string,
      use: Effect.Effect<A, E>,
      waitForWriter = false,
    ): Effect.Effect<A, E | CliFilesystemError | CliStorageError> =>
      Effect.acquireUseRelease(
        acquireLock(diagramId, waitForWriter),
        () => recoverRecordTransactions(diagramId).pipe(Effect.andThen(use)),
        (lock) =>
          // The protected result is authoritative; lock cleanup is recoverable.
          releaseLock(diagramId, lock).pipe(Effect.catch(() => Effect.void)),
      );

    const decodeManifest = Effect.fn("sketchi.cli.storage.decodeManifest")(
      function* (path: string, diagramId: string) {
        const text = yield* fs.readText(path);
        const parsed: unknown = yield* Effect.try({
          try: () => JSON.parse(text),
          catch: () =>
            storageError(
              "corrupt_record",
              `Diagram "${diagramId}" has an invalid manifest.`,
              "Inspect manifest.json and restore it from a known-good backup.",
              diagramId,
            ),
        });
        return yield* Schema.decodeUnknownEffect(DiagramRecordManifest)(
          parsed,
        ).pipe(
          Effect.mapError(() =>
            storageError(
              "corrupt_record",
              `Diagram "${diagramId}" has an incompatible manifest.`,
              `Expected manifest schema version ${String(RECORD_SCHEMA_VERSION)}.`,
              diagramId,
            ),
          ),
        );
      },
    );

    const decodeDocument = Effect.fn("sketchi.cli.storage.decodeDocument")(
      function* (path: string, diagramId: string) {
        const text = yield* fs.readText(path);
        const parsed: unknown = yield* Effect.try({
          try: () => JSON.parse(text),
          catch: () =>
            storageError(
              "corrupt_record",
              `Diagram "${diagramId}" has invalid document JSON.`,
              "Recover a prior canonical document from the revisions directory.",
              diagramId,
            ),
        });
        return yield* decodeStoredDiagramDocument(parsed).pipe(
          Effect.mapError(() =>
            storageError(
              "corrupt_record",
              `Diagram "${diagramId}" has an invalid canonical document.`,
              "Recover a prior canonical document from the revisions directory.",
              diagramId,
            ),
          ),
        );
      },
    );

    const loadUnlocked = Effect.fn("sketchi.cli.storage.loadUnlocked")(
      function* (diagramId: string) {
        const path = recordPath(root.path, diagramId);
        const kind = yield* fs.kind(path);
        if (kind === "missing") {
          return yield* storageError(
            "diagram_not_found",
            `Diagram "${diagramId}" does not exist.`,
            "Run sketchi list to discover stored diagram ids.",
            diagramId,
          );
        }
        if (kind !== "directory") return yield* unsafeEntry(path, diagramId);
        yield* assertSafeTree(path, diagramId);
        const manifest = yield* decodeManifest(
          join(path, MANIFEST_FILE),
          diagramId,
        );
        if (manifest.id !== diagramId) {
          return yield* storageError(
            "corrupt_record",
            `Diagram directory "${diagramId}" contains manifest id "${manifest.id}".`,
            "Make the directory name and manifest id agree before retrying.",
            diagramId,
          );
        }
        const document = yield* decodeDocument(
          join(path, DOCUMENT_FILE),
          diagramId,
        );
        if (
          manifest.type !== document.type ||
          manifest.title !== document.spec.title
        ) {
          return yield* storageError(
            "corrupt_record",
            `Diagram "${diagramId}" manifest does not match its canonical document.`,
            "Recover the canonical document and rebuild the record with sketchi edit.",
            diagramId,
          );
        }
        for (const requiredFile of [SCENE_FILE, EXCALIDRAW_FILE]) {
          if ((yield* fs.kind(join(path, requiredFile))) !== "file") {
            return yield* storageError(
              "corrupt_record",
              `Diagram "${diagramId}" is missing required artifact ${requiredFile}.`,
              "Recover the canonical document and rebuild the record with sketchi edit.",
              diagramId,
            );
          }
        }
        const pngKind = yield* fs.kind(join(path, PNG_FILE));
        if (pngKind !== "file" && pngKind !== "missing") {
          return yield* unsafeEntry(join(path, PNG_FILE), diagramId);
        }
        if (
          pngKind === "file" &&
          !isValidPng(yield* fs.readBytes(join(path, PNG_FILE)))
        ) {
          return yield* storageError(
            "corrupt_record",
            `Diagram "${diagramId}" has an invalid stored PNG artifact.`,
            "Recover a valid prior revision or rebuild the record.",
            diagramId,
          );
        }
        const expectedFormats: ReadonlyArray<DiagramFormat> =
          manifest.authority === "detached"
            ? pngKind === "file"
              ? ["excalidraw", "png"]
              : ["excalidraw"]
            : pngKind === "file"
              ? ["scene", "excalidraw", "png"]
              : ["scene", "excalidraw"];
        if (
          manifest.formats.length !== expectedFormats.length ||
          manifest.formats.some(
            (format, index) => format !== expectedFormats[index],
          )
        ) {
          return yield* storageError(
            "corrupt_record",
            `Diagram "${diagramId}" manifest formats do not match stored artifacts.`,
            "Recover the canonical document and rebuild the record with sketchi edit.",
            diagramId,
          );
        }
        const revisionDirectory = join(path, REVISIONS_DIRECTORY);
        const revisions: string[] = [];
        for (const entry of yield* fs.list(revisionDirectory)) {
          if (entry.kind === "file" && /^\d{6,}\.json$/u.test(entry.name)) {
            revisions.push(entry.name);
            continue;
          }
          if (entry.kind === "directory" && /^\d{6,}$/u.test(entry.name)) {
            revisions.push(`${entry.name}/`);
            continue;
          }
          return yield* unsafeEntry(
            join(revisionDirectory, entry.name),
            diagramId,
          );
        }
        revisions.sort(compareRevisionEntries);
        return {
          manifest,
          document,
          revisions,
          authority: manifest.authority,
          documentAuthoritative: manifest.authority === "canonical",
        } satisfies StoredDiagram;
      },
    );

    const copySafeTree: (
      source: string,
      destination: string,
      diagramId: string,
    ) => Effect.Effect<void, CliFilesystemError | CliStorageError> = Effect.fn(
      "sketchi.cli.storage.copySafeTree",
    )(function* (source: string, destination: string, diagramId: string) {
      const entries = yield* fs.list(source);
      for (const entry of entries) {
        const sourcePath = join(source, entry.name);
        const destinationPath = join(destination, entry.name);
        if (entry.kind === "directory") {
          yield* fs.makeDirectory(destinationPath);
          yield* copySafeTree(sourcePath, destinationPath, diagramId);
        } else if (entry.kind === "file") {
          const bytes = yield* fs.readBytes(sourcePath);
          yield* fs.writeBytes(destinationPath, bytes);
        } else {
          return yield* unsafeEntry(sourcePath, diagramId);
        }
      }
    });

    const copyRecordSnapshot = Effect.fn(
      "sketchi.cli.storage.copyRecordSnapshot",
    )(function* (source: string, destination: string, diagramId: string) {
      yield* fs.makeDirectory(destination);
      for (const entry of yield* fs.list(source)) {
        if (entry.name === REVISIONS_DIRECTORY) continue;
        const sourcePath = join(source, entry.name);
        const destinationPath = join(destination, entry.name);
        if (entry.kind === "file") {
          yield* fs.writeBytes(
            destinationPath,
            yield* fs.readBytes(sourcePath),
          );
        } else {
          return yield* unsafeEntry(sourcePath, diagramId);
        }
      }
    });

    const commitStage = Effect.fn("sketchi.cli.storage.commitStage")(function* (
      diagramId: string,
      stage: string,
    ) {
      const source = recordPath(root.path, diagramId);
      const backup = join(
        root.path,
        `${BACKUP_PREFIX}${encodedId(diagramId)}.${String(process.pid)}.${crypto.randomUUID()}`,
      );
      yield* fs.rename(source, backup);
      const committed = yield* fs.rename(stage, source).pipe(
        Effect.matchEffect({
          onFailure: (commitError) =>
            fs.rename(backup, source).pipe(
              Effect.matchEffect({
                onFailure: () =>
                  Effect.fail(
                    storageError(
                      "storage_commit_failed",
                      `Atomic storage commit and rollback both failed for "${diagramId}".`,
                      "Retry; Sketchi will recover the backup transaction before the next operation.",
                      diagramId,
                    ),
                  ),
                onSuccess: () => Effect.fail(commitError),
              }),
            ),
          onSuccess: () => Effect.succeed(true),
        }),
      );
      if (committed) {
        yield* fs.remove(backup).pipe(Effect.catch(() => Effect.void));
      }
    });

    const snapshotCurrent = Effect.fn("sketchi.cli.storage.snapshotCurrent")(
      function* (diagramId: string, stage: string, currentRevision: number) {
        const destination = join(
          stage,
          REVISIONS_DIRECTORY,
          revisionDirectoryName(currentRevision),
        );
        if ((yield* fs.kind(destination)) !== "missing") {
          return yield* storageError(
            "corrupt_record",
            `Diagram "${diagramId}" already has a snapshot for current revision ${String(currentRevision)}.`,
            "Inspect the revisions directory before retrying.",
            diagramId,
          );
        }
        yield* copyRecordSnapshot(
          recordPath(root.path, diagramId),
          destination,
          diagramId,
        );
      },
    );

    const writeBuilt = Effect.fn("sketchi.cli.storage.writeBuilt")(function* (
      stage: string,
      diagram: BuiltDiagram,
      manifest: DiagramRecordManifest,
    ) {
      yield* fs.makeDirectory(join(stage, REVISIONS_DIRECTORY), true);
      yield* fs.writeText(
        join(stage, DOCUMENT_FILE),
        encodeJson(diagram.document),
        true,
      );
      yield* fs.writeText(
        join(stage, SCENE_FILE),
        encodeJson(diagram.scene),
        true,
      );
      yield* fs.writeText(
        join(stage, EXCALIDRAW_FILE),
        encodeJson(diagram.excalidraw),
        true,
      );
      const pngPath = join(stage, PNG_FILE);
      yield* fs.remove(pngPath);
      if (diagram.png) yield* fs.writeBytes(pngPath, diagram.png);
      yield* fs.writeText(
        join(stage, MANIFEST_FILE),
        encodeJson(manifest),
        true,
      );
    });

    const create = Effect.fn("sketchi.cli.storage.create")(function* (
      diagram: BuiltDiagram,
    ) {
      return yield* withLock(
        diagram.id,
        Effect.gen(function* () {
          const destination = recordPath(root.path, diagram.id);
          if ((yield* fs.kind(destination)) !== "missing") {
            return yield* storageError(
              "diagram_already_exists",
              `Diagram "${diagram.id}" already exists.`,
              "Use sketchi edit for full-document replacement.",
              diagram.id,
            );
          }
          const manifest = DiagramRecordManifest.make({
            schemaVersion: RECORD_SCHEMA_VERSION,
            id: diagram.id,
            type: diagram.type,
            title: diagram.title,
            revision: 1,
            authority: "canonical",
            formats: diagram.png
              ? ["scene", "excalidraw", "png"]
              : ["scene", "excalidraw"],
          });
          return yield* Effect.acquireUseRelease(
            fs.makeTempDirectory(root.path, STAGE_PREFIX),
            (stage) =>
              Effect.gen(function* () {
                yield* writeBuilt(stage, diagram, manifest);
                yield* fs.rename(stage, destination);
                return {
                  manifest,
                  document: diagram.document,
                  revisions: [],
                  authority: "canonical",
                  documentAuthoritative: true,
                } satisfies StoredDiagram;
              }),
            (stage) => fs.remove(stage),
          );
        }),
      );
    });

    const edit = Effect.fn("sketchi.cli.storage.edit")(function* (
      diagramId: string,
      diagram: BuiltDiagram,
    ) {
      return yield* withLock(
        diagramId,
        Effect.gen(function* () {
          const current = yield* loadUnlocked(diagramId);
          if (current.authority !== "canonical") {
            return yield* storageError(
              "detached_edit",
              `Diagram "${diagramId}" does not have an authoritative canonical document.`,
              "Restore a canonical revision before editing this diagram.",
              diagramId,
            );
          }
          if (diagram.id !== diagramId) {
            return yield* storageError(
              "storage_commit_failed",
              `Edited document id "${diagram.id}" does not match "${diagramId}".`,
              "Keep spec.id equal to the diagram id being edited.",
              diagramId,
            );
          }
          const source = recordPath(root.path, diagramId);
          const manifest = DiagramRecordManifest.make({
            schemaVersion: RECORD_SCHEMA_VERSION,
            id: diagramId,
            type: diagram.type,
            title: diagram.title,
            revision: current.manifest.revision + 1,
            authority: "canonical",
            formats: diagram.png
              ? ["scene", "excalidraw", "png"]
              : ["scene", "excalidraw"],
          });
          return yield* Effect.acquireUseRelease(
            fs.makeTempDirectory(root.path, STAGE_PREFIX),
            (stage) =>
              Effect.gen(function* () {
                yield* copySafeTree(source, stage, diagramId);
                yield* snapshotCurrent(
                  diagramId,
                  stage,
                  current.manifest.revision,
                );
                yield* writeBuilt(stage, diagram, manifest);
                yield* commitStage(diagramId, stage);
                return {
                  manifest,
                  document: diagram.document,
                  revisions: [
                    ...current.revisions,
                    `${revisionDirectoryName(current.manifest.revision)}/`,
                  ].sort(compareRevisionEntries),
                  authority: "canonical",
                  documentAuthoritative: true,
                } satisfies StoredDiagram;
              }),
            (stage) => fs.remove(stage),
          );
        }),
      );
    });

    const patchSourceUnavailable = (diagramId: string) =>
      storageError(
        "patch_source_unavailable",
        `Diagram "${diagramId}" has no current authoritative scene to patch.`,
        "Restore a canonical or patched revision before patching this diagram.",
        diagramId,
      );

    const readPatchSourceUnlocked = Effect.fn(
      "sketchi.cli.storage.readPatchSourceUnlocked",
    )(function* (diagramId: string) {
      const current = yield* loadUnlocked(diagramId);
      if (
        current.authority === "detached" ||
        !current.manifest.formats.includes("scene")
      ) {
        return yield* patchSourceUnavailable(diagramId);
      }
      const scenePath = join(recordPath(root.path, diagramId), SCENE_FILE);
      const text = yield* fs.readText(scenePath);
      const decoded = yield* Effect.sync(() => {
        try {
          return RenderedDiagramSceneSchema.safeParse(JSON.parse(text));
        } catch {
          return undefined;
        }
      });
      if (!decoded?.success || decoded.data.diagramId !== diagramId) {
        return yield* storageError(
          "corrupt_record",
          `Diagram "${diagramId}" has an invalid current scene artifact.`,
          "Restore a valid prior revision before patching this diagram.",
          diagramId,
        );
      }
      return {
        revision: current.manifest.revision,
        scene: decoded.data,
      } satisfies PatchSource;
    });

    const readPatchSource = Effect.fn("sketchi.cli.storage.readPatchSource")(
      (diagramId: string) =>
        withLock(diagramId, readPatchSourceUnlocked(diagramId), true),
    );

    const commitPatch = Effect.fn("sketchi.cli.storage.commitPatch")(function* (
      diagramId: string,
      expectedRevision: number,
      artifacts: PatchedDiagramArtifacts,
    ) {
      return yield* withLock(
        diagramId,
        Effect.gen(function* () {
          const current = yield* loadUnlocked(diagramId);
          if (current.manifest.revision !== expectedRevision) {
            return yield* storageError(
              "patch_conflict",
              `Diagram "${diagramId}" changed before the patch could commit.`,
              "Run sketchi show, verify the current record, and retry the patch if it is still intended.",
              diagramId,
            );
          }
          if (
            current.authority === "detached" ||
            !current.manifest.formats.includes("scene")
          ) {
            return yield* patchSourceUnavailable(diagramId);
          }
          if (artifacts.scene.diagramId !== diagramId) {
            return yield* storageError(
              "storage_commit_failed",
              `Patched scene id "${artifacts.scene.diagramId}" does not match "${diagramId}".`,
              "Retry the patch against the named stored diagram.",
              diagramId,
            );
          }
          const source = recordPath(root.path, diagramId);
          const manifest = DiagramRecordManifest.make({
            schemaVersion: RECORD_SCHEMA_VERSION,
            id: diagramId,
            type: current.manifest.type,
            title: current.manifest.title,
            revision: current.manifest.revision + 1,
            authority: "patched",
            formats: ["scene", "excalidraw"],
          });
          return yield* Effect.acquireUseRelease(
            fs.makeTempDirectory(root.path, STAGE_PREFIX),
            (stage) =>
              Effect.gen(function* () {
                yield* copySafeTree(source, stage, diagramId);
                yield* snapshotCurrent(
                  diagramId,
                  stage,
                  current.manifest.revision,
                );
                yield* fs.writeText(
                  join(stage, SCENE_FILE),
                  encodeJson(artifacts.scene),
                  true,
                );
                yield* fs.writeText(
                  join(stage, EXCALIDRAW_FILE),
                  encodeJson(artifacts.excalidraw),
                  true,
                );
                yield* fs.remove(join(stage, PNG_FILE));
                yield* fs.writeText(
                  join(stage, MANIFEST_FILE),
                  encodeJson(manifest),
                  true,
                );
                yield* commitStage(diagramId, stage);
                return {
                  manifest,
                  document: current.document,
                  revisions: [
                    ...current.revisions,
                    `${revisionDirectoryName(current.manifest.revision)}/`,
                  ].sort(compareRevisionEntries),
                  authority: "patched",
                  documentAuthoritative: false,
                } satisfies StoredDiagram;
              }),
            (stage) => fs.remove(stage),
          );
        }),
      );
    });

    const revisionNotFound = (diagramId: string, revision: number) =>
      storageError(
        "revision_not_found",
        `Diagram "${diagramId}" has no revision ${String(revision)}.`,
        "Run sketchi show to inspect the available revision paths.",
        diagramId,
      );

    const corruptRevision = (diagramId: string, revision: number) =>
      storageError(
        "corrupt_revision",
        `Diagram "${diagramId}" revision ${String(revision)} is corrupt.`,
        "Choose another revision or repair the corrupt snapshot.",
        diagramId,
      );

    const readArchivedJson = Effect.fn(
      "sketchi.cli.storage.validateArchivedJson",
    )(function* (path: string, diagramId: string, revision: number) {
      const text = yield* fs.readText(path);
      return yield* Effect.try({
        try: () => {
          const value: unknown = JSON.parse(text);
          if (typeof value !== "object" || value === null) {
            throw new Error("archived JSON must contain an object");
          }
          return value;
        },
        catch: () => corruptRevision(diagramId, revision),
      });
    });

    const validateArchivedArtifact = Effect.fn(
      "sketchi.cli.storage.validateArchivedArtifact",
    )(function* (
      path: string,
      kind: "scene" | "excalidraw",
      authority: "canonical" | "patched" | "detached",
      diagramId: string,
      revision: number,
    ) {
      const value = yield* readArchivedJson(path, diagramId, revision);
      const decoded =
        kind === "scene"
          ? RenderedDiagramSceneSchema.safeParse(value)
          : ExcalidrawFileSchema.safeParse(value);
      if (!decoded.success) return yield* corruptRevision(diagramId, revision);
      if (kind === "excalidraw" && authority === "detached") {
        yield* validateShareScene(value).pipe(
          Effect.mapError(() => corruptRevision(diagramId, revision)),
        );
      }
    });

    const validateArchivedPng = Effect.fn(
      "sketchi.cli.storage.validateArchivedPng",
    )(function* (path: string, diagramId: string, revision: number) {
      const bytes = yield* fs.readBytes(path);
      if (!isValidPng(bytes)) {
        return yield* corruptRevision(diagramId, revision);
      }
    });

    const readRevisionUnlocked = Effect.fn(
      "sketchi.cli.storage.readRevisionUnlocked",
    )(function* (diagramId: string, revision: number) {
      yield* loadUnlocked(diagramId);
      const revisions = join(
        recordPath(root.path, diagramId),
        REVISIONS_DIRECTORY,
      );
      const snapshot = join(revisions, revisionDirectoryName(revision));
      const snapshotKind = yield* fs.kind(snapshot);
      if (snapshotKind === "directory") {
        yield* assertSafeTree(snapshot, diagramId);
        const manifest = yield* decodeManifest(
          join(snapshot, MANIFEST_FILE),
          diagramId,
        ).pipe(Effect.mapError(() => corruptRevision(diagramId, revision)));
        const document = yield* decodeDocument(
          join(snapshot, DOCUMENT_FILE),
          diagramId,
        ).pipe(Effect.mapError(() => corruptRevision(diagramId, revision)));
        if (
          manifest.id !== diagramId ||
          manifest.revision !== revision ||
          manifest.type !== document.type ||
          manifest.title !== document.spec.title
        ) {
          return yield* storageError(
            "corrupt_revision",
            `Diagram "${diagramId}" revision ${String(revision)} has inconsistent metadata.`,
            "Choose another revision or repair the corrupt snapshot.",
            diagramId,
          );
        }
        for (const [required, kind] of [
          [SCENE_FILE, "scene"],
          [EXCALIDRAW_FILE, "excalidraw"],
        ] as const) {
          const artifactPath = join(snapshot, required);
          if ((yield* fs.kind(artifactPath)) !== "file") {
            return yield* storageError(
              "corrupt_revision",
              `Diagram "${diagramId}" revision ${String(revision)} is missing ${required}.`,
              "Choose another revision or repair the corrupt snapshot.",
              diagramId,
            );
          }
          yield* validateArchivedArtifact(
            artifactPath,
            kind,
            manifest.authority,
            diagramId,
            revision,
          ).pipe(
            Effect.mapError((error) =>
              error._tag === "CliFilesystemError"
                ? corruptRevision(diagramId, revision)
                : error,
            ),
          );
        }
        const pngKind = yield* fs.kind(join(snapshot, PNG_FILE));
        if (pngKind !== "file" && pngKind !== "missing") {
          return yield* unsafeEntry(join(snapshot, PNG_FILE), diagramId);
        }
        if (pngKind === "file") {
          yield* validateArchivedPng(
            join(snapshot, PNG_FILE),
            diagramId,
            revision,
          ).pipe(
            Effect.mapError((error) =>
              error._tag === "CliFilesystemError"
                ? corruptRevision(diagramId, revision)
                : error,
            ),
          );
        }
        const formats: ReadonlyArray<DiagramFormat> =
          manifest.authority !== "detached"
            ? pngKind === "file"
              ? ["scene", "excalidraw", "png"]
              : ["scene", "excalidraw"]
            : pngKind === "file"
              ? ["excalidraw", "png"]
              : ["excalidraw"];
        if (
          manifest.formats.length !== formats.length ||
          manifest.formats.some((format, index) => format !== formats[index])
        ) {
          return yield* storageError(
            "corrupt_revision",
            `Diagram "${diagramId}" revision ${String(revision)} has inconsistent formats.`,
            "Choose another revision or repair the corrupt snapshot.",
            diagramId,
          );
        }
        return { _tag: "FullSnapshot", revision } satisfies RevisionSource;
      }
      if (snapshotKind !== "missing") {
        return yield* unsafeEntry(snapshot, diagramId);
      }
      const legacy = join(revisions, revisionFileName(revision));
      const legacyKind = yield* fs.kind(legacy);
      if (legacyKind === "missing") {
        return yield* revisionNotFound(diagramId, revision);
      }
      if (legacyKind !== "file") return yield* unsafeEntry(legacy, diagramId);
      const document = yield* decodeCanonicalDiagramDocument(
        yield* readArchivedJson(legacy, diagramId, revision),
      ).pipe(
        Effect.mapError(() =>
          storageError(
            "corrupt_revision",
            `Diagram "${diagramId}" revision ${String(revision)} is corrupt.`,
            "Choose another revision or repair the legacy revision file.",
            diagramId,
          ),
        ),
      );
      return {
        _tag: "LegacyDocument",
        revision,
        document,
      } satisfies RevisionSource;
    });

    const replaceWithDetached = Effect.fn(
      "sketchi.cli.storage.replaceWithDetached",
    )(function* (
      diagramId: string,
      excalidraw: Uint8Array,
      expectedRevision?: number,
    ) {
      return yield* withLock(
        diagramId,
        Effect.gen(function* () {
          const current = yield* loadUnlocked(diagramId);
          if (
            expectedRevision !== undefined &&
            current.manifest.revision !== expectedRevision
          ) {
            return yield* storageError(
              "replacement_conflict",
              `Diagram "${diagramId}" changed before the pulled replacement could commit.`,
              "Run sketchi show, verify the current record, and retry the pull if it is still intended.",
              diagramId,
            );
          }
          const source = recordPath(root.path, diagramId);
          const manifest = DiagramRecordManifest.make({
            schemaVersion: RECORD_SCHEMA_VERSION,
            id: diagramId,
            type: current.manifest.type,
            title: current.manifest.title,
            revision: current.manifest.revision + 1,
            authority: "detached",
            formats: ["excalidraw"],
          });
          return yield* Effect.acquireUseRelease(
            fs.makeTempDirectory(root.path, STAGE_PREFIX),
            (stage) =>
              Effect.gen(function* () {
                yield* copySafeTree(source, stage, diagramId);
                yield* snapshotCurrent(
                  diagramId,
                  stage,
                  current.manifest.revision,
                );
                yield* fs.writeBytes(
                  join(stage, EXCALIDRAW_FILE),
                  excalidraw,
                  true,
                );
                yield* fs.remove(join(stage, PNG_FILE));
                yield* fs.writeText(
                  join(stage, MANIFEST_FILE),
                  encodeJson(manifest),
                  true,
                );
                yield* commitStage(diagramId, stage);
                return {
                  manifest,
                  document: current.document,
                  revisions: [
                    ...current.revisions,
                    `${revisionDirectoryName(current.manifest.revision)}/`,
                  ].sort(compareRevisionEntries),
                  authority: "detached",
                  documentAuthoritative: false,
                } satisfies StoredDiagram;
              }),
            (stage) => fs.remove(stage),
          );
        }),
      );
    });

    const readRevision = Effect.fn("sketchi.cli.storage.readRevision")(
      (diagramId: string, revision: number) =>
        withLock(diagramId, readRevisionUnlocked(diagramId, revision), true),
    );

    const restore = Effect.fn("sketchi.cli.storage.restore")(function* (
      diagramId: string,
      revision: number,
      legacyDiagram?: BuiltDiagram,
    ) {
      return yield* withLock(
        diagramId,
        Effect.gen(function* () {
          const current = yield* loadUnlocked(diagramId);
          const selected = yield* readRevisionUnlocked(diagramId, revision);
          if (selected._tag === "LegacyDocument") {
            if (current.authority !== "canonical" || !legacyDiagram) {
              return yield* storageError(
                "restore_conflict",
                `Legacy revision ${String(revision)} requires a canonical rebuild for "${diagramId}".`,
                "Restore a full canonical snapshot, or provide the rebuilt legacy document.",
                diagramId,
              );
            }
            if (
              legacyDiagram.id !== diagramId ||
              encodeJson(legacyDiagram.document) !==
                encodeJson(selected.document)
            ) {
              return yield* storageError(
                "storage_commit_failed",
                `Legacy revision ${String(revision)} rebuild does not match its archived document.`,
                "Rebuild the exact archived canonical document before restoring.",
                diagramId,
              );
            }
          }
          const source = recordPath(root.path, diagramId);
          return yield* Effect.acquireUseRelease(
            fs.makeTempDirectory(root.path, STAGE_PREFIX),
            (stage) =>
              Effect.gen(function* () {
                yield* copySafeTree(source, stage, diagramId);
                yield* snapshotCurrent(
                  diagramId,
                  stage,
                  current.manifest.revision,
                );
                const revisions = [
                  ...current.revisions,
                  `${revisionDirectoryName(current.manifest.revision)}/`,
                ].sort(compareRevisionEntries);
                const diagram = yield* selected._tag === "FullSnapshot"
                  ? Effect.gen(function* () {
                      const selectedPath = join(
                        stage,
                        REVISIONS_DIRECTORY,
                        revisionDirectoryName(revision),
                      );
                      for (const entry of yield* fs.list(stage)) {
                        if (entry.name !== REVISIONS_DIRECTORY) {
                          yield* fs.remove(join(stage, entry.name));
                        }
                      }
                      yield* copySafeTree(selectedPath, stage, diagramId);
                      const manifestPath = join(stage, MANIFEST_FILE);
                      const archivedText = yield* fs.readText(manifestPath);
                      yield* decodeManifest(manifestPath, diagramId);
                      const document = yield* decodeDocument(
                        join(stage, DOCUMENT_FILE),
                        diagramId,
                      );
                      const restoredManifestText = replaceManifestRevision(
                        archivedText,
                        current.manifest.revision + 1,
                      );
                      if (restoredManifestText === undefined) {
                        return yield* corruptRevision(diagramId, revision);
                      }
                      yield* fs.writeText(
                        manifestPath,
                        restoredManifestText,
                        true,
                      );
                      const manifest = yield* decodeManifest(
                        manifestPath,
                        diagramId,
                      );
                      return {
                        manifest,
                        document,
                        revisions,
                        authority: manifest.authority,
                        documentAuthoritative:
                          manifest.authority === "canonical",
                      } satisfies StoredDiagram;
                    })
                  : Effect.gen(function* () {
                      if (!legacyDiagram) {
                        return yield* storageError(
                          "storage_commit_failed",
                          `Legacy revision ${String(revision)} has no rebuilt document.`,
                          "Rebuild the archived canonical document before restoring.",
                          diagramId,
                        );
                      }
                      const manifest = DiagramRecordManifest.make({
                        schemaVersion: RECORD_SCHEMA_VERSION,
                        id: diagramId,
                        type: legacyDiagram.type,
                        title: legacyDiagram.title,
                        revision: current.manifest.revision + 1,
                        authority: "canonical",
                        formats: legacyDiagram.png
                          ? ["scene", "excalidraw", "png"]
                          : ["scene", "excalidraw"],
                      });
                      yield* writeBuilt(stage, legacyDiagram, manifest);
                      return {
                        manifest,
                        document: legacyDiagram.document,
                        revisions,
                        authority: "canonical",
                        documentAuthoritative: true,
                      } satisfies StoredDiagram;
                    });
                yield* commitStage(diagramId, stage);
                return {
                  diagram,
                  restoredFromRevision: revision,
                } satisfies RestoreResult;
              }),
            (stage) => fs.remove(stage),
          );
        }),
      );
    });

    const show = Effect.fn("sketchi.cli.storage.show")((diagramId: string) =>
      withLock(diagramId, loadUnlocked(diagramId), true),
    );

    const list = Effect.fn("sketchi.cli.storage.list")(function* () {
      yield* ensureRoot();
      yield* recoverStages();
      const diagramIds = new Set<string>();
      for (const entry of yield* fs.list(root.path)) {
        if (isVisibleRecord(entry)) {
          diagramIds.add(entry.name);
          continue;
        }
        if (!entry.name.startsWith(BACKUP_PREFIX)) continue;
        const id = decodedId(entry.name.split(".")[2] ?? "");
        if (id) diagramIds.add(id);
      }
      const summaries: DiagramSummary[] = [];
      for (const diagramId of [...diagramIds].sort(compareCodeUnits)) {
        const stored = yield* show(diagramId);
        summaries.push(summaryFromStored(stored));
      }
      return summaries;
    });

    const readExportSource = Effect.fn("sketchi.cli.storage.readExportSource")(
      function* (diagramId: string, format: DiagramFormat) {
        return yield* withLock(
          diagramId,
          Effect.gen(function* () {
            const stored = yield* loadUnlocked(diagramId);
            if (stored.manifest.formats.includes(format)) {
              return {
                _tag: "StoredArtifact",
                bytes: yield* fs.readBytes(
                  join(recordPath(root.path, diagramId), artifactFile(format)),
                ),
              } as const;
            }
            if (format !== "png") {
              return yield* CliExportError.make({
                code: "format_unavailable",
                format,
                message: `Diagram "${diagramId}" has no stored ${format} artifact.`,
                hint: "Edit the diagram to rebuild its local artifacts.",
              });
            }
            if (stored.authority === "detached") {
              return {
                _tag: "RenderPng",
                excalidraw: yield* fs.readBytes(
                  join(
                    recordPath(root.path, diagramId),
                    artifactFile("excalidraw"),
                  ),
                ),
              } as const;
            }
            for (const renderFormat of ["scene", "excalidraw"] as const) {
              if (!stored.manifest.formats.includes(renderFormat)) {
                return yield* CliExportError.make({
                  code: "format_unavailable",
                  format: renderFormat,
                  message: `Diagram "${diagramId}" has no stored ${renderFormat} artifact.`,
                  hint: "Edit the diagram to rebuild its local artifacts.",
                });
              }
            }
            const [scene, excalidraw] = yield* Effect.all([
              fs.readBytes(
                join(recordPath(root.path, diagramId), artifactFile("scene")),
              ),
              fs.readBytes(
                join(
                  recordPath(root.path, diagramId),
                  artifactFile("excalidraw"),
                ),
              ),
            ]);
            return { _tag: "RenderPng", scene, excalidraw } as const;
          }),
          true,
        );
      },
    );

    return {
      create,
      edit,
      readPatchSource,
      commitPatch,
      replaceWithDetached,
      readRevision,
      restore,
      show,
      list,
      readExportSource,
    };
  }),
);

export { DiagramStoreLive };

export const writeExportFile = Effect.fn("sketchi.cli.export.writeFile")(
  function* (destination: string, bytes: Uint8Array) {
    const fs = yield* LocalFileSystem;
    const root = yield* StorageRoot;
    const absoluteDestination = resolve(destination);
    const parent = dirname(absoluteDestination);
    const destinationDirectoryError = () =>
      CliExportError.make({
        code: "export_write_failed",
        format: basename(destination),
        message: `Export destination directory does not exist: ${parent}.`,
        hint: "Create the destination directory and retry.",
      });
    const resolvedParent = yield* fs
      .realPath(parent)
      .pipe(Effect.mapError(destinationDirectoryError));
    if ((yield* fs.kind(resolvedParent)) !== "directory") {
      return yield* destinationDirectoryError();
    }
    const resolvedRoot = yield* fs.realPath(root.path);
    const resolvedDestination = join(
      resolvedParent,
      basename(absoluteDestination),
    );
    const destinationFromRoot = relative(resolvedRoot, resolvedDestination);
    if (
      destinationFromRoot === "" ||
      (!destinationFromRoot.startsWith("..") &&
        !isAbsolute(destinationFromRoot))
    ) {
      return yield* CliExportError.make({
        code: "invalid_destination",
        format: basename(destination),
        message: `Export destination is inside Sketchi's diagram storage: ${destination}.`,
        hint: "Choose a destination outside ~/.sketchi/diagrams so the stored record remains valid.",
      });
    }
    const temp = join(
      resolvedParent,
      `.${basename(destination)}.sketchi.${String(process.pid)}.${crypto.randomUUID()}`,
    );
    return yield* Effect.acquireUseRelease(
      Effect.succeed(temp),
      (path) =>
        fs.writeBytes(path, bytes).pipe(
          Effect.andThen(fs.rename(path, resolvedDestination)),
          Effect.mapError(() =>
            CliExportError.make({
              code: "export_write_failed",
              format: basename(destination),
              message: `Unable to write export destination ${destination}.`,
              hint: "Check the destination path and permissions, then retry.",
            }),
          ),
        ),
      (path) => fs.remove(path),
    );
  },
);
