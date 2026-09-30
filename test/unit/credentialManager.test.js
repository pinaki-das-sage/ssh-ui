// Purpose: Tests secure persistence and removal of trusted SFTP host fingerprints.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return { window: { showErrorMessage: () => {} } };
    return originalLoad.call(this, request, parent, isMain);
};
const CredentialManager = require('../../src/credentialManager');
Module._load = originalLoad;

test('persists a trusted SFTP fingerprint per server and port', async () => {
    const values = new Map();
    const manager = new CredentialManager({
        get: async key => values.get(key),
        store: async (key, value) => values.set(key, value),
        delete: async key => values.delete(key),
    });
    const host = { host: 'server.example.com', port: 2222 };

    await manager.storeSftpHostFingerprint(host, 'SHA256:trusted');

    assert.equal(await manager.getSftpHostFingerprint(host), 'SHA256:trusted');
    await manager.deleteSftpHostFingerprint(host);
    assert.equal(await manager.getSftpHostFingerprint(host), null);
});
