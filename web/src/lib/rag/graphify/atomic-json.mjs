import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Readers see either the previous complete snapshot or the next complete snapshot.
 * @param {string} path
 * @param {unknown} value
 */
export function writeAtomicJson(path, value) {
  const serialized = JSON.stringify(value);
  mkdirSync(dirname(path), { recursive: true });
  const pending = `${path}.${randomUUID()}.pending`;
  /** @type {number | undefined} */
  let fd;
  try {
    fd = openSync(pending, "wx", 0o600);
    writeFileSync(fd, serialized);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(pending, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(pending); } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}
