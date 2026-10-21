'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const AVATAR_EXT = new Set(['.vrm']);
const ANIM_EXT = new Set(['.vrma']);
const ENV_EXT = new Set(['.gif', '.png', '.jpg', '.jpeg']);

/** @type {Map<string, string>} id → absolute file path */
const fileIndex = new Map();

/**
 * @param {string} absolutePath
 */
function makeId(kind, absolutePath) {
  const hash = crypto.createHash('sha1').update(absolutePath).digest('hex').slice(0, 12);
  const base = path.basename(absolutePath).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
  return `lib-${kind}-${base}-${hash}`;
}

/**
 * @param {string} filePath
 */
function labelFromFile(filePath) {
  const base = path.basename(filePath).replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/[_-]+/g, ' ').trim();
  if (cleaned.length > 24) return `${cleaned.slice(0, 22)}…`;
  return cleaned || 'Untitled';
}

/**
 * @param {unknown} dirPath
 * @returns {string | null}
 */
function normalizeDir(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.trim() === '') return null;
  const resolved = path.resolve(dirPath.trim());
  try {
    if (!fs.statSync(resolved).isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

/** Guards against a symlink loop, and against scanning someone's whole drive. */
const MAX_SCAN_DEPTH = 4;

/**
 * Collect matching files under `dir`, descending into subfolders. The immediate
 * subfolder a file sits in is carried back as `group`, which is what lets a
 * library keep its 30 static poses in `poses/` instead of cluttering one flat
 * list with the full-motion clips (files at the root have no group).
 *
 * @param {string} dir absolute, already normalized
 * @param {Set<string>} allowedExt
 * @param {'avatar' | 'anim' | 'env'} kind
 * @param {string | null} group
 * @param {number} depth
 * @param {object[]} out
 */
function collectFiles(dir, allowedExt, kind, group, depth, out) {
  let dirEntries;
  try {
    dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirEntry of dirEntries) {
    const absolutePath = path.join(dir, dirEntry.name);

    if (dirEntry.isDirectory()) {
      if (depth >= MAX_SCAN_DEPTH) continue;
      // Only the top level names a group: a folder nested deeper keeps the
      // group of the subfolder it lives under, so the menu stays two levels.
      collectFiles(absolutePath, allowedExt, kind, group ?? dirEntry.name, depth + 1, out);
      continue;
    }

    if (!dirEntry.isFile()) continue;
    if (!allowedExt.has(path.extname(dirEntry.name).toLowerCase())) continue;

    const id = makeId(kind, absolutePath);
    fileIndex.set(id, absolutePath);
    out.push({
      id,
      label: labelFromFile(absolutePath),
      fileName: dirEntry.name,
      group,
    });
  }
}

/**
 * @param {string} dirPath
 * @param {Set<string>} allowedExt
 * @param {'avatar' | 'anim' | 'env'} kind
 * @param {boolean} [recursive] Animations only — avatars and environments are
 *   picked one at a time, so a nested folder there is more likely to be a stray
 *   backup than a deliberate grouping.
 */
function scanDirectory(dirPath, allowedExt, kind, recursive = false) {
  const dir = normalizeDir(dirPath);
  if (!dir) return [];

  const entries = [];
  collectFiles(dir, allowedExt, kind, null, recursive ? 0 : MAX_SCAN_DEPTH, entries);

  // Ungrouped (root) files first, then each subfolder's, alphabetical within.
  return entries.sort(
    (a, b) =>
      (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label),
  );
}

/**
 * @param {unknown} dirPath
 */
function scanAvatars(dirPath) {
  return scanDirectory(dirPath, AVATAR_EXT, 'avatar');
}

/**
 * @param {unknown} dirPath
 */
function scanAnimations(dirPath) {
  return scanDirectory(dirPath, ANIM_EXT, 'anim', true);
}

/**
 * @param {unknown} dirPath
 */
function scanEnvironments(dirPath) {
  return scanDirectory(dirPath, ENV_EXT, 'env');
}

/**
 * @param {unknown} id
 * @returns {Buffer}
 */
function resolveReadablePath(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('Missing library file id.');
  }
  const absolutePath = fileIndex.get(id);
  if (!absolutePath) {
    throw new Error('Unknown library file. Refresh the directory and try again.');
  }
  return absolutePath;
}

function readLibraryFile(id) {
  const absolutePath = resolveReadablePath(id);
  // Ensure the indexed path still exists and is a regular file.
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error('Library path is not a file.');
  }
  return fs.readFileSync(absolutePath);
}

/**
 * The same read off the main thread. Environment images are fetched while the
 * user is watching — a synchronous read of a 20MB gif blocks the main process,
 * and with it the window, for as long as the disk takes.
 *
 * @param {unknown} id
 * @returns {Promise<Buffer>}
 */
async function readLibraryFileAsync(id) {
  const absolutePath = resolveReadablePath(id);
  const stat = await fs.promises.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error('Library path is not a file.');
  }
  return fs.promises.readFile(absolutePath);
}

/**
 * @param {unknown} dirPath
 */
function pathExists(dirPath) {
  return normalizeDir(dirPath) != null;
}

/**
 * The absolute path behind a scanned id, for callers that need to stat the
 * file rather than read it (the thumbnail cache keys on mtime and size).
 * @param {unknown} id
 * @returns {string | null}
 */
function resolveLibraryPath(id) {
  if (typeof id !== 'string' || id.trim() === '') return null;
  return fileIndex.get(id) ?? null;
}

module.exports = {
  scanAvatars,
  scanAnimations,
  scanEnvironments,
  readLibraryFile,
  readLibraryFileAsync,
  resolveLibraryPath,
  pathExists,
  normalizeDir,
};
