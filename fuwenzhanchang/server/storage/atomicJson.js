import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonFile(filePath, { maxBytes = 2 * 1024 * 1024 } = {}) {
  let stats;
  try {
    stats = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Refusing to read a non-regular JSON data file.");
  }
  if (stats.size > maxBytes) throw new Error("JSON data file exceeds its size limit.");
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJsonFileAtomic(
  filePath,
  value,
  { maxBytes = 2 * 1024 * 1024 } = {},
) {
  const directory = path.dirname(filePath);
  const payload = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(payload) > maxBytes) {
    throw new Error("JSON data exceeds its size limit.");
  }

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await fs.open(
      tempPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function syncDirectoryBestEffort(directory) {
  let handle;
  try {
    handle = await fs.open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform, including Windows.
  } finally {
    await handle?.close().catch(() => {});
  }
}
