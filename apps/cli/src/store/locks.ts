import { join } from "node:path";

import { Effect, Schedule } from "effect";

import { encodeJson } from "../document";
import type { CliFilesystemError, CliStorageError } from "../errors";
import {
	BACKUP_PREFIX,
	LOCKS_DIRECTORY,
	compareCodeUnits,
	encodedId,
	filesystemErrorHasCode,
	recordPath,
	storageError,
	unsafeEntry,
} from "./entries";
import { processIsAlive, type makeRecovery } from "./recovery";
import type { StoreContext } from "./service";

const LOCK_FREE_PREFIX = "free.";
const LOCK_OWNER_PREFIX = "owner.";
const LOCK_OWNER_CANDIDATE_PREFIX = ".owner-candidate.";
const LOCK_ENTRY_SUFFIX = ".json";
const LOCK_RECOVERY_TOKEN = "recovery";
const LOCK_INIT_PREFIX = ".init.";
const READ_LOCK_RETRY_DELAY = "10 millis";
const READ_LOCK_RETRY_LIMIT = 50;
const READ_LOCK_RETRY_POLICY = Schedule.spaced(READ_LOCK_RETRY_DELAY).pipe(
	Schedule.upTo({ times: READ_LOCK_RETRY_LIMIT }),
);

function lockOwner(text: string): { readonly pid: number; readonly token: string } | undefined {
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
	const parts = name.slice(LOCK_FREE_PREFIX.length, -LOCK_ENTRY_SUFFIX.length).split(".");
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
	if (!name.startsWith(LOCK_OWNER_CANDIDATE_PREFIX) || !name.endsWith(LOCK_ENTRY_SUFFIX)) {
		return undefined;
	}
	const token = name.slice(LOCK_OWNER_CANDIDATE_PREFIX.length, -LOCK_ENTRY_SUFFIX.length);
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

/** Per-record cross-process locks: one writer, readers wait briefly for it. */
export function makeLocks(
	{ fs, root }: StoreContext,
	{ ensureRoot, recoverStages, recoverRecordTransactions }: ReturnType<typeof makeRecovery>,
) {
	const lockDirectory = (diagramId: string) =>
		join(root.path, LOCKS_DIRECTORY, `${encodedId(diagramId)}.lock`);

	const initializeLockDirectory = Effect.fn("sketchi.cli.storage.initializeLockDirectory")(
		function* (diagramId: string) {
			const directory = lockDirectory(diagramId);
			const existing = yield* fs.kind(directory);
			if (existing === "directory") return directory;
			if (existing !== "missing") return yield* unsafeEntry(directory, diagramId);

			const parent = join(root.path, LOCKS_DIRECTORY);
			return yield* Effect.acquireUseRelease(
				fs.makeTempDirectory(parent, `${LOCK_INIT_PREFIX}${encodedId(diagramId)}.`),
				(candidate) =>
					Effect.gen(function* () {
						const token = crypto.randomUUID();
						yield* fs.writeText(
							join(candidate, `${LOCK_FREE_PREFIX}${token}${LOCK_ENTRY_SUFFIX}`),
							encodeJson({ token }),
						);
						const installed = yield* fs.tryRenameDirectory(candidate, directory);
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
		},
	);

	const busyError = (diagramId: string) =>
		storageError(
			"diagram_busy",
			`Diagram "${diagramId}" is being changed by another Sketchi process.`,
			"Wait for that command to finish, then retry.",
			diagramId,
		);

	const readLockEntries = Effect.fn("sketchi.cli.storage.readLockEntries")(function* (
		directory: string,
		diagramId: string,
	) {
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
					...(free.releasedOwnerToken ? { releasedOwnerToken: free.releasedOwnerToken } : {}),
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
			if (!entry.name.startsWith(LOCK_OWNER_PREFIX) || !entry.name.endsWith(LOCK_ENTRY_SUFFIX)) {
				return yield* unsafeEntry(path, diagramId);
			}
			const text = yield* fs
				.readText(path)
				.pipe(
					Effect.mapError((error) =>
						filesystemErrorHasCode(error, "ENOENT") ? busyError(diagramId) : error,
					),
				);
			const owner = lockOwner(text);
			if (!owner) return yield* busyError(diagramId);
			if (entry.name !== `${LOCK_OWNER_PREFIX}${owner.token}${LOCK_ENTRY_SUFFIX}`) {
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
	});

	const acquireLockOnce: (
		diagramId: string,
	) => Effect.Effect<LockHandle, CliFilesystemError | CliStorageError> = Effect.fn(
		"sketchi.cli.storage.acquireLockOnce",
	)(function* (diagramId: string) {
		const directory = yield* initializeLockDirectory(diagramId);
		const snapshot = yield* readLockEntries(directory, diagramId);
		const releasedOwnerTokens = new Set(
			snapshot.flatMap((entry) => (entry.releasedOwnerToken ? [entry.releasedOwnerToken] : [])),
		);
		if (
			snapshot.some(
				(entry) => entry.state === "live-owner" && !releasedOwnerTokens.has(entry.token),
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
		const ownerPath = join(directory, `${LOCK_OWNER_PREFIX}${token}${LOCK_ENTRY_SUFFIX}`);
		const candidatePath = join(
			directory,
			`${LOCK_OWNER_CANDIDATE_PREFIX}${token}${LOCK_ENTRY_SUFFIX}`,
		);
		return yield* Effect.uninterruptible(
			Effect.acquireUseRelease(
				Effect.succeed(candidatePath),
				() =>
					Effect.gen(function* () {
						yield* fs.writeText(candidatePath, encodeJson({ pid: process.pid, token }));
						const published = yield* fs.tryLinkFile(candidatePath, ownerPath);
						if (!published) return yield* busyError(diagramId);

						const acquired = yield* fs
							.removeFile(target.path)
							.pipe(
								Effect.catch((error) =>
									fs.removeFile(ownerPath).pipe(Effect.andThen(Effect.fail(error))),
								),
							);
						if (!acquired) {
							yield* fs.removeFile(ownerPath);
							return yield* busyError(diagramId);
						}
						for (const entry of snapshot) {
							if (entry.path === target.path) continue;
							yield* fs.removeFile(entry.path).pipe(Effect.catch(() => Effect.void));
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
						while: (error) => error._tag === "CliStorageError" && error.code === "diagram_busy",
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
		const markerInstalled = yield* fs.tryWriteText(freePath, marker).pipe(
			Effect.catch(() => fs.kind(freePath).pipe(Effect.map((kind) => kind === "file"))),
			Effect.catch(() => Effect.succeed(false)),
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

	const notFound = (diagramId: string) =>
		storageError(
			"diagram_not_found",
			`Diagram "${diagramId}" does not exist.`,
			"Run sketchi list to discover stored diagram ids.",
			diagramId,
		);

	const withLock = <A, E>(
		diagramId: string,
		use: Effect.Effect<A, E>,
		waitForWriter = false,
		rootPrepared = false,
	): Effect.Effect<A, E | CliFilesystemError | CliStorageError> =>
		Effect.gen(function* () {
			if (waitForWriter) {
				const path = recordPath(root.path, diagramId);
				const kind = yield* fs.kind(path);
				if (kind === "missing") {
					const rootKind = yield* fs.kind(root.path);
					if (rootKind === "missing") return yield* notFound(diagramId);
					if (rootKind !== "directory") return yield* unsafeEntry(root.path, diagramId);
					// A writer holds this persistent lock directory throughout its
					// rename gap. Let the locked load decide whether the record exists.
					const directory = lockDirectory(diagramId);
					const lockKind = yield* fs.kind(directory);
					if (lockKind === "missing") {
						const entries = yield* fs.list(root.path);
						const prefix = `${BACKUP_PREFIX}${encodedId(diagramId)}.`;
						if (
							!entries.some((entry) => entry.name === diagramId || entry.name.startsWith(prefix))
						) {
							return yield* notFound(diagramId);
						}
					} else if (lockKind !== "directory") {
						return yield* unsafeEntry(directory, diagramId);
					}
				} else if (kind !== "directory") {
					return yield* unsafeEntry(path, diagramId);
				}
			}
			if (!rootPrepared) {
				yield* ensureRoot();
				yield* recoverStages();
			}
			return yield* Effect.acquireUseRelease(
				acquireLock(diagramId, waitForWriter),
				() => recoverRecordTransactions(diagramId).pipe(Effect.andThen(use)),
				(lock) =>
					// The protected result is authoritative; lock cleanup is recoverable.
					releaseLock(diagramId, lock).pipe(Effect.catch(() => Effect.void)),
			);
		});

	return { withLock };
}
