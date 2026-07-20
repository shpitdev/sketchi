import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

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
  type StoredDiagram,
  revisionFileName,
  summaryFromStored,
} from "./contracts.js";
import { decodeCanonicalDiagramDocument, encodeJson } from "./document.js";
import {
  CliExportError,
  CliFilesystemError,
  CliStorageError,
} from "./errors.js";
import { LocalFileSystem, type LocalEntry } from "./filesystem.js";

export class StorageRoot extends Context.Service<
  StorageRoot,
  { readonly path: string }
>()("@sketchi/cli/StorageRoot") {}

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
    readonly show: (
      diagramId: string,
    ) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
    readonly list: () => Effect.Effect<
      ReadonlyArray<DiagramSummary>,
      CliFilesystemError | CliStorageError
    >;
    readonly readArtifact: (
      diagramId: string,
      format: DiagramFormat,
    ) => Effect.Effect<
      Uint8Array,
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
        return yield* decodeCanonicalDiagramDocument(parsed).pipe(
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
        const expectedFormats: ReadonlyArray<DiagramFormat> =
          pngKind === "file"
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
        const revisions = [...(yield* fs.list(revisionDirectory))]
          .filter(
            (entry) => entry.kind === "file" && entry.name.endsWith(".json"),
          )
          .map((entry) => entry.name)
          .sort(compareCodeUnits);
        return { manifest, document, revisions } satisfies StoredDiagram;
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
            formats: diagram.png
              ? ["scene", "excalidraw", "png"]
              : ["scene", "excalidraw"],
          });
          return yield* Effect.acquireUseRelease(
            fs.makeTempDirectory(root.path, STAGE_PREFIX),
            (stage) =>
              Effect.gen(function* () {
                yield* copySafeTree(source, stage, diagramId);
                yield* fs.writeText(
                  join(
                    stage,
                    REVISIONS_DIRECTORY,
                    revisionFileName(current.manifest.revision),
                  ),
                  encodeJson(current.document),
                );
                yield* writeBuilt(stage, diagram, manifest);

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
                                `Atomic edit commit and rollback both failed for "${diagramId}".`,
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
                  yield* fs
                    .remove(backup)
                    .pipe(Effect.catch(() => Effect.void));
                }
                return {
                  manifest,
                  document: diagram.document,
                  revisions: [
                    ...current.revisions,
                    revisionFileName(current.manifest.revision),
                  ].sort(compareCodeUnits),
                } satisfies StoredDiagram;
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

    const readArtifact = Effect.fn("sketchi.cli.storage.readArtifact")(
      function* (diagramId: string, format: DiagramFormat) {
        return yield* withLock(
          diagramId,
          Effect.gen(function* () {
            const stored = yield* loadUnlocked(diagramId);
            if (!stored.manifest.formats.includes(format)) {
              return yield* CliExportError.make({
                code: "format_unavailable",
                format,
                message: `Diagram "${diagramId}" has no stored ${format} artifact.`,
                hint:
                  format === "png"
                    ? "PNG export is offline-only and requires an already-stored PNG artifact."
                    : "Edit the diagram to rebuild its local artifacts.",
              });
            }
            return yield* fs.readBytes(
              join(recordPath(root.path, diagramId), artifactFile(format)),
            );
          }),
          true,
        );
      },
    );

    return { create, edit, show, list, readArtifact };
  }),
);

export { DiagramStoreLive };

export const writeExportFile = Effect.fn("sketchi.cli.export.writeFile")(
  function* (destination: string, bytes: Uint8Array) {
    const fs = yield* LocalFileSystem;
    const parent = dirname(destination);
    if ((yield* fs.kind(parent)) !== "directory") {
      return yield* CliExportError.make({
        code: "export_write_failed",
        format: basename(destination),
        message: `Export destination directory does not exist: ${parent}.`,
        hint: "Create the destination directory and retry.",
      });
    }
    const temp = join(
      parent,
      `.${basename(destination)}.sketchi.${String(process.pid)}.${crypto.randomUUID()}`,
    );
    return yield* Effect.acquireUseRelease(
      Effect.succeed(temp),
      (path) =>
        fs.writeBytes(path, bytes).pipe(
          Effect.andThen(fs.rename(path, destination)),
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
