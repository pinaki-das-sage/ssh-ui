// Purpose: Verifies secure temporary SSH askpass helpers and shell-safe terminal commands.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
    createAskpassEnvironment,
    buildInteractiveSshCommand,
} = require('../../src/sshAuth');

describe('createAskpassEnvironment', () => {
    test('creates a unique private helper and removes it on cleanup', () => {
        const first = createAskpassEnvironment('first-password');
        const second = createAskpassEnvironment('second-password');

        try {
            assert.notEqual(first.env.SSH_ASKPASS, second.env.SSH_ASKPASS);
            assert.ok(fs.existsSync(first.env.SSH_ASKPASS));
            assert.ok(fs.readFileSync(first.env.SSH_ASKPASS, 'utf8').includes('_SSH_UI_PASS'));
            assert.equal(first.env._SSH_UI_PASS, 'first-password');
        } finally {
            first.cleanup();
            second.cleanup();
        }

        assert.equal(fs.existsSync(first.env.SSH_ASKPASS), false);
        assert.equal(fs.existsSync(second.env.SSH_ASKPASS), false);
    });
});

describe('buildInteractiveSshCommand', () => {
    test('quotes every config-derived argument before sending it to a shell terminal', () => {
        const command = buildInteractiveSshCommand({
            user: 'alice; touch unsafe',
            host: 'server.example.com; touch unsafe',
            port: 2222,
            identityFile: "/Users/alice/.ssh/key's name",
        });

        assert.equal(
            command,
            "ssh -t -p '2222' -i '/Users/alice/.ssh/key'\\''s name' 'alice; touch unsafe@server.example.com; touch unsafe'"
        );
    });
});
