import { constants } from "node:fs";
import {
  mkdir,
  link,
  lstat,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";

import { Context, Effect, Layer } from "effect";

import { CliFilesystemError } from "./errors.js";

export type LocalEntryKind = "file" | "directory" | "symbolic-link" | "other";

export interface LocalEntry {
  readonly name: string;
  readonly kind: LocalEntryKind;
}

export class LocalFileSystem extends Context.Service<
  LocalFileSystem,
  {
    readonly makeDirectory: (
      path: string,
      recursive?: boolean,
    ) => Effect.Effect<void, CliFilesystemError>;
    readonly tryWriteText: (
      path: string,
      value: string,
    ) => Effect.Effect<boolean, CliFilesystemError>;
    readonly tryLinkFile: (
      source: string,
      destination: string,
    ) => Effect.Effect<boolean, CliFilesystemError>;
    readonly makeTempDirectory: (
      parent: string,
      prefix: string,
    ) => Effect.Effect<string, CliFilesystemError>;
    readonly list: (
      path: string,
    ) => Effect.Effect<ReadonlyArray<LocalEntry>, CliFilesystemError>;
    readonly kind: (
      path: string,
    ) => Effect.Effect<LocalEntryKind | "missing", CliFilesystemError>;
    readonly readText: (
      path: string,
    ) => Effect.Effect<string, CliFilesystemError>;
    readonly readBytes: (
      path: string,
    ) => Effect.Effect<Uint8Array, CliFilesystemError>;
    readonly writeText: (
      path: string,
      value: string,
      replace?: boolean,
    ) => Effect.Effect<void, CliFilesystemError>;
    readonly writeBytes: (
      path: string,
      value: Uint8Array,
      replace?: boolean,
    ) => Effect.Effect<void, CliFilesystemError>;
    readonly rename: (
      source: string,
      destination: string,
    ) => Effect.Effect<void, CliFilesystemError>;
    readonly tryRenameDirectory: (
      source: string,
      destination: string,
    ) => Effect.Effect<boolean, CliFilesystemError>;
    readonly removeFile: (
      path: string,
    ) => Effect.Effect<boolean, CliFilesystemError>;
    readonly remove: (path: string) => Effect.Effect<void, CliFilesystemError>;
  }
>()("@sketchi/cli/LocalFileSystem") {}

function filesystemError(operation: string, path: string, cause: unknown) {
  return CliFilesystemError.make({
    cause,
    operation,
    path,
    message: `Filesystem ${operation} failed for ${path}.`,
  });
}

function hasCode(cause: unknown, code: string): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === code
  );
}

function entryKind(entry: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): LocalEntryKind {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "directory";
  if (entry.isSymbolicLink()) return "symbolic-link";
  return "other";
}

export const localFileSystemLive = {
  makeDirectory: (path, recursive = false) =>
    Effect.tryPromise({
      try: () => mkdir(path, { recursive }).then(() => undefined),
      catch: (cause) => filesystemError("make-directory", path, cause),
    }),
  tryWriteText: (path, value) =>
    Effect.tryPromise({
      try: async () => {
        try {
          const handle = await open(
            path,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o600,
          );
          try {
            await handle.writeFile(value, { encoding: "utf8" });
            await handle.sync();
          } finally {
            await handle.close();
          }
          return true;
        } catch (cause) {
          if (hasCode(cause, "EEXIST")) return false;
          throw cause;
        }
      },
      catch: (cause) => filesystemError("write-exclusive", path, cause),
    }),
  tryLinkFile: (source, destination) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await link(source, destination);
          return true;
        } catch (cause) {
          if (hasCode(cause, "EEXIST") || hasCode(cause, "ENOENT")) {
            return false;
          }
          throw cause;
        }
      },
      catch: (cause) =>
        filesystemError("link-exclusive", `${source} -> ${destination}`, cause),
    }),
  makeTempDirectory: (parent, prefix) =>
    Effect.tryPromise({
      try: () => mkdtemp(join(parent, prefix)),
      catch: (cause) => filesystemError("make-temp-directory", parent, cause),
    }),
  list: (path) =>
    Effect.tryPromise({
      try: async () => {
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          kind: entryKind(entry),
        }));
      },
      catch: (cause) => filesystemError("read-directory", path, cause),
    }),
  kind: (path) =>
    Effect.tryPromise({
      try: async () => {
        try {
          const info = await lstat(path);
          if (info.isFile()) return "file";
          if (info.isDirectory()) return "directory";
          if (info.isSymbolicLink()) return "symbolic-link";
          return "other";
        } catch (cause) {
          if (hasCode(cause, "ENOENT")) return "missing";
          if (hasCode(cause, "ELOOP")) return "symbolic-link";
          throw cause;
        }
      },
      catch: (cause) => filesystemError("stat", path, cause),
    }),
  readText: (path) =>
    Effect.tryPromise({
      try: async () => {
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          return await handle.readFile({ encoding: "utf8" });
        } finally {
          await handle.close();
        }
      },
      catch: (cause) => filesystemError("read", path, cause),
    }),
  readBytes: (path) =>
    Effect.tryPromise({
      try: async () => {
        const handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          return new Uint8Array(await handle.readFile());
        } finally {
          await handle.close();
        }
      },
      catch: (cause) => filesystemError("read", path, cause),
    }),
  writeText: (path, value, replace = false) =>
    Effect.tryPromise({
      try: async () => {
        const flags =
          constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_NOFOLLOW |
          (replace ? constants.O_TRUNC : constants.O_EXCL);
        const handle = await open(path, flags, 0o600);
        try {
          await handle.writeFile(value, { encoding: "utf8" });
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
      catch: (cause) => filesystemError("write", path, cause),
    }),
  writeBytes: (path, value, replace = false) =>
    Effect.tryPromise({
      try: async () => {
        const flags =
          constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_NOFOLLOW |
          (replace ? constants.O_TRUNC : constants.O_EXCL);
        const handle = await open(path, flags, 0o600);
        try {
          await handle.writeFile(value);
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
      catch: (cause) => filesystemError("write", path, cause),
    }),
  rename: (source, destination) =>
    Effect.tryPromise({
      try: () => rename(source, destination),
      catch: (cause) =>
        filesystemError("rename", `${source} -> ${destination}`, cause),
    }),
  tryRenameDirectory: (source, destination) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await rename(source, destination);
          return true;
        } catch (cause) {
          if (hasCode(cause, "EEXIST") || hasCode(cause, "ENOTEMPTY")) {
            return false;
          }
          if (hasCode(cause, "EPERM")) {
            try {
              if ((await lstat(destination)).isDirectory()) return false;
            } catch {
              // Preserve the original rename failure when no directory won.
            }
          }
          throw cause;
        }
      },
      catch: (cause) =>
        filesystemError(
          "rename-exclusive-directory",
          `${source} -> ${destination}`,
          cause,
        ),
    }),
  removeFile: (path) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await unlink(path);
          return true;
        } catch (cause) {
          if (hasCode(cause, "ENOENT")) return false;
          throw cause;
        }
      },
      catch: (cause) => filesystemError("remove-file", path, cause),
    }),
  remove: (path) =>
    Effect.tryPromise({
      try: () => rm(path, { recursive: true, force: true }),
      catch: (cause) => filesystemError("remove", path, cause),
    }),
} satisfies (typeof LocalFileSystem)["Service"];

const LocalFileSystemLive = Layer.succeed(LocalFileSystem, localFileSystemLive);

export { LocalFileSystemLive };
