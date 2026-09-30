// Purpose: Connects to verified SFTP hosts and performs file and folder transfers.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const SftpClient = require('ssh2-sftp-client');
const { shouldIgnore, needsUpload, collectLocalFiles } = require('./sftpSync');

/**
 * Build the connection options for ssh2-sftp-client. Unlike OpenSSH, ssh2
 * auto-accepts a server key unless a hostVerifier is supplied. A configured
 * fingerprint is a strict override; otherwise a trusted fingerprint or an
 * explicit first-use/change confirmation controls access.
 */
function createConnectionConfig(host, password, trustedFingerprint, onUntrustedFingerprint) {
    const configuredFingerprint = host.sftp && host.sftp.hostFingerprint;
    const normalizeFingerprint = (value, label) => {
        if (typeof value !== 'string' || !value.trim()) return null;
        const normalized = value.trim().replace(/^SHA256:/i, '').replace(/=+$/, '');
        if (!/^[A-Za-z0-9+/]{43}$/.test(normalized)) {
            throw new Error(`SFTP host "${host.name}" has an invalid ${label}; expected SHA256:<base64>.`);
        }
        return normalized;
    };
    const configured = normalizeFingerprint(configuredFingerprint, 'sftp.hostFingerprint');
    const trusted = normalizeFingerprint(trustedFingerprint, 'stored SFTP host fingerprint');

    const config = {
        host: host.host,
        port: host.port,
        username: host.user,
        hostVerifier: (hostKey, callback) => {
            const complete = permitted => {
                if (typeof callback === 'function') {
                    callback(permitted);
                    return undefined;
                }
                return permitted;
            };
            if (!Buffer.isBuffer(hostKey)) return complete(false);

            const actualFingerprint = crypto.createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '');
            const expectedFingerprint = configured || trusted;
            if (expectedFingerprint) {
                const actual = Buffer.from(actualFingerprint);
                const expected = Buffer.from(expectedFingerprint);
                const matches = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
                if (matches || configured) return complete(matches);
            }

            if (typeof callback !== 'function' || typeof onUntrustedFingerprint !== 'function') {
                return complete(false);
            }
            Promise.resolve(onUntrustedFingerprint(`SHA256:${actualFingerprint}`, !!trusted))
                .then(accepted => callback(accepted === true), () => callback(false));
            return undefined;
        },
    };

    if (host.identityFile) {
        const identityPath = host.identityFile.startsWith('~/')
            ? path.join(os.homedir(), host.identityFile.slice(2))
            : host.identityFile;
        config.privateKey = fs.readFileSync(identityPath);
        if (password) config.passphrase = password;
    } else if (password) {
        config.password = password;
    }

    return config;
}

class SftpManager {
    constructor(credentialManager, confirmHostTrust) {
        this._credentialManager = credentialManager;
        this._confirmHostTrust = confirmHostTrust;
    }

    async connect(host) {
        const client = new SftpClient(`remote-toolkit-${host.name}`);
        const password = this._credentialManager
            ? await this._credentialManager.getPassword(host)
            : null;
        const trustedFingerprint = this._credentialManager
            ? await this._credentialManager.getSftpHostFingerprint(host)
            : null;
        await client.connect(createConnectionConfig(
            host,
            password,
            trustedFingerprint,
            async (fingerprint, isChanged) => {
                if (typeof this._confirmHostTrust !== 'function') return false;
                const accepted = await this._confirmHostTrust(host, fingerprint, isChanged);
                if (accepted && this._credentialManager) {
                    await this._credentialManager.storeSftpHostFingerprint(host, fingerprint);
                }
                return accepted;
            }
        ));
        return client;
    }

    async withClient(host, operation) {
        const client = await this.connect(host);
        try {
            return await operation(client);
        } finally {
            await client.end();
        }
    }

    async list(host, remotePath) {
        return this.withClient(host, client => client.list(remotePath));
    }

    async upload(host, localPath, remotePath) {
        return this.withClient(host, async (client) => {
            const parentDirectory = path.posix.dirname(remotePath);
            if (parentDirectory !== '/') {
                await client.mkdir(parentDirectory, true);
            }
            return client.put(localPath, remotePath);
        });
    }

    async download(host, remotePath, localPath) {
        return this.withClient(host, client => client.get(remotePath, localPath));
    }

    /**
     * Sync a local directory tree to the host's configured sftp.remotePath.
     * Respects host.sftp.ignore (plain name matching) and host.sftp.syncMode
     * ("update" = skip unchanged files, "mirror" = also delete remote extras).
     *
     * @param {object} host
     * @param {string} localRootDir  Absolute local directory to sync from
     * @param {(message: string) => void} onProgress  Called with a log line per action
     * @returns {Promise<{uploaded: string[], deleted: string[], skipped: number}>}
     */
    async syncFolder(host, localRootDir, onProgress) {
        const sftp = host.sftp || {};
        const remoteRoot = sftp.remotePath || '/';
        const syncMode = sftp.syncMode || 'update';
        const ignoreList = sftp.ignore || [];
        const log = onProgress || (() => {});

        const localFiles = collectLocalFiles(localRootDir, ignoreList);
        const uploaded = [];
        let skipped = 0;

        return this.withClient(host, async (client) => {
            for (const file of localFiles) {
                const remotePath = path.posix.join(remoteRoot, file.relativePath);
                let remoteMtimeMs = null;
                try {
                    const stat = await client.stat(remotePath);
                    remoteMtimeMs = stat.modifyTime;
                } catch (_) {
                    remoteMtimeMs = null; // remote file does not exist
                }

                if (!needsUpload(syncMode, file.mtimeMs, remoteMtimeMs)) {
                    skipped++;
                    continue;
                }

                await client.mkdir(path.posix.dirname(remotePath), true);
                await client.put(file.absolutePath, remotePath);
                uploaded.push(file.relativePath);
                log(`Uploaded ${file.relativePath}`);
            }

            const deleted = [];
            if (syncMode === 'mirror') {
                const localRelativeSet = new Set(localFiles.map(f => f.relativePath));
                await this._deleteRemoteExtras(client, remoteRoot, '', localRelativeSet, ignoreList, deleted, log);
            }

            return { uploaded, deleted, skipped };
        });
    }

    /** Recursively removes remote files/dirs not present locally (mirror mode). */
    async _deleteRemoteExtras(client, remoteRoot, relativeDir, localRelativeSet, ignoreList, deleted, log) {
        const remoteDir = path.posix.join(remoteRoot, relativeDir);
        let entries;
        try {
            entries = await client.list(remoteDir);
        } catch (_) {
            return; // remote directory doesn't exist — nothing to mirror-delete
        }

        for (const entry of entries) {
            const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            if (shouldIgnore(relativePath, ignoreList)) continue;

            if (entry.type === 'd') {
                await this._deleteRemoteExtras(client, remoteRoot, relativePath, localRelativeSet, ignoreList, deleted, log);
            } else if (!localRelativeSet.has(relativePath)) {
                const remotePath = path.posix.join(remoteRoot, relativePath);
                await client.delete(remotePath);
                deleted.push(relativePath);
                log(`Deleted ${relativePath} (mirror mode, not present locally)`);
            }
        }
    }
}

module.exports = SftpManager;
module.exports.createConnectionConfig = createConnectionConfig;
