// Purpose: Verifies SFTP connection security and remote-parent creation for file uploads.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const SftpManager = require('../../src/sftpManager');
const { createConnectionConfig } = require('../../src/sftpManager');

const hostKey = Buffer.from('trusted-host-public-key');
const hostFingerprint = `SHA256:${crypto.createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
const host = {
    name: 'trusted-host',
    host: 'server.example.com',
    port: 22,
    user: 'alice',
    sftp: { remotePath: '/remote/project', hostFingerprint },
};

const hostWithoutConfiguredFingerprint = {
    ...host,
    sftp: { remotePath: '/remote/project' },
};

function verifyAsync(hostVerifier, key) {
    return new Promise(resolve => hostVerifier(key, resolve));
}

describe('createConnectionConfig', () => {
    test('uses an optional configured SHA-256 fingerprint as a strict override', () => {
        const config = createConnectionConfig(host, null);

        assert.equal(config.host, host.host);
        assert.equal(config.hostVerifier(hostKey), true);
        assert.equal(config.hostVerifier(Buffer.from('untrusted-host-public-key')), false);
    });

    test('uses a previously trusted fingerprint when config omits one', () => {
        const config = createConnectionConfig(hostWithoutConfiguredFingerprint, null, hostFingerprint);

        assert.equal(config.hostVerifier(hostKey), true);
        assert.equal(config.hostVerifier(Buffer.from('untrusted-host-public-key')), false);
    });

    test('asks to trust an unknown host key before allowing the first connection', async () => {
        const prompts = [];
        const config = createConnectionConfig(hostWithoutConfiguredFingerprint, null, null, async (fingerprint, isChanged) => {
            prompts.push({ fingerprint, isChanged });
            return true;
        });

        assert.equal(await verifyAsync(config.hostVerifier, hostKey), true);
        assert.deepEqual(prompts, [{ fingerprint: hostFingerprint, isChanged: false }]);
    });

    test('asks for explicit replacement when a previously trusted host key changes', async () => {
        const prompts = [];
        const config = createConnectionConfig(
            hostWithoutConfiguredFingerprint,
            null,
            'SHA256:2SmKENGwc1fQ8+CEPMv5QCYpZXnE0NYGQQBcz+au9b0',
            async (fingerprint, isChanged) => {
                prompts.push({ fingerprint, isChanged });
                return false;
            }
        );

        assert.equal(await verifyAsync(config.hostVerifier, hostKey), false);
        assert.deepEqual(prompts, [{ fingerprint: hostFingerprint, isChanged: true }]);
    });
});

describe('upload', () => {
    test('creates the remote parent directory before uploading a nested file', async () => {
        const manager = new SftpManager(null);
        const calls = [];
        manager.withClient = async (_host, operation) => operation({
            mkdir: async (...args) => calls.push(['mkdir', ...args]),
            put: async (...args) => calls.push(['put', ...args]),
        });

        await manager.upload(host, '/workspace/src/file.php', '/remote/project/src/file.php');

        assert.deepEqual(calls, [
            ['mkdir', '/remote/project/src', true],
            ['put', '/workspace/src/file.php', '/remote/project/src/file.php'],
        ]);
    });
});
