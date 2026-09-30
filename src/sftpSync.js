// Purpose: Supplies pure SFTP sync decisions and local workspace file collection.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Whether a workspace-relative path should be excluded from sync.
 * Matches on exact path segment (folder or file name), not substring.
 *
 * @param {string} relativePath  Posix-style relative path, e.g. "src/node_modules/foo.js"
 * @param {string[]} [ignoreList]  Plain names to exclude, e.g. [".git", "node_modules"]
 * @returns {boolean}
 */
function shouldIgnore(relativePath, ignoreList) {
    if (!ignoreList || ignoreList.length === 0) return false;
    const segments = relativePath.split('/');
    return segments.some(segment => ignoreList.includes(segment));
}

/**
 * Whether a local file needs to be pushed to the remote host.
 *
 * @param {string|undefined} syncMode  "update" (default) or "mirror"
 * @param {number} localMtimeMs
 * @param {number|null} remoteMtimeMs  null if the remote file does not exist
 * @returns {boolean}
 */
function needsUpload(syncMode, localMtimeMs, remoteMtimeMs) {
    if (syncMode === 'mirror') return true;
    if (remoteMtimeMs == null) return true;
    return localMtimeMs > remoteMtimeMs;
}

/**
 * Whether a file save should trigger an SFTP upload.
 *
 * @param {boolean} isManualSave  True for an explicit Ctrl+S save
 * @param {boolean} [uploadOnAutoSave]  Per-host opt-in for autosave uploads
 * @returns {boolean}
 */
function shouldUploadOnSave(isManualSave, uploadOnAutoSave) {
    return isManualSave || !!uploadOnAutoSave;
}

/**
 * Recursively collect syncable files under a local root directory.
 * Ignored folders are skipped entirely (not descended into).
 *
 * @param {string} rootDir  Absolute local directory to walk
 * @param {string[]} [ignoreList]
 * @returns {Array<{relativePath: string, absolutePath: string, mtimeMs: number}>}
 */
function collectLocalFiles(rootDir, ignoreList) {
    const results = [];

    function walk(currentDir, relativeDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            if (shouldIgnore(relativePath, ignoreList)) continue;

            const absolutePath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(absolutePath, relativePath);
            } else if (entry.isFile()) {
                const stat = fs.statSync(absolutePath);
                results.push({ relativePath, absolutePath, mtimeMs: stat.mtimeMs });
            }
        }
    }

    walk(rootDir, '');
    return results;
}

module.exports = { shouldIgnore, needsUpload, shouldUploadOnSave, collectLocalFiles };
