// Purpose: Tests PHPUnit SSH command construction and credential handling.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
    buildSshArgs,
    buildRemoteCommand,
    buildTerminalCommand,
    runFolder,
} = require('../../src/phpunitRunner');

// ── buildRemoteCommand ────────────────────────────────────────────────────────

describe('buildRemoteCommand', () => {
    test('run all: returns cd + bin with no trailing args', () => {
        const cmd = buildRemoteCommand('/var/www/app', './vendor/bin/phpunit', null, null, null);
        assert.equal(cmd, "cd '/var/www/app' && './vendor/bin/phpunit'");
    });

    test('run file: appends relative file path', () => {
        const cmd = buildRemoteCommand('/var/www/app', './vendor/bin/phpunit', 'tests/FooTest.php', null, null);
        assert.equal(cmd, "cd '/var/www/app' && './vendor/bin/phpunit' 'tests/FooTest.php'");
    });

    test('run folder: exposes a folder runner and passes the workspace-relative folder to PHPUnit', () => {
        const cmd = buildRemoteCommand('/var/www/app', './vendor/bin/phpunit', 'app/tests/source/cre', null, null);
        assert.equal(cmd, "cd '/var/www/app' && './vendor/bin/phpunit' 'app/tests/source/cre'");
        assert.equal(typeof runFolder, 'function');
    });

    test('run method: appends anchored --filter and file', () => {
        const cmd = buildRemoteCommand('/var/www/app', './vendor/bin/phpunit', 'tests/FooTest.php', 'FooTest', 'testBarWorks');
        assert.equal(cmd, "cd '/var/www/app' && './vendor/bin/phpunit' --filter '^FooTest::testBarWorks$' 'tests/FooTest.php'");
    });

    test('run method without file: --filter only', () => {
        const cmd = buildRemoteCommand('/var/www/app', './vendor/bin/phpunit', null, 'FooTest', 'testBarWorks');
        assert.equal(cmd, "cd '/var/www/app' && './vendor/bin/phpunit' --filter '^FooTest::testBarWorks$'");
    });

    test('escapes shell-sensitive remote path and file path', () => {
        const cmd = buildRemoteCommand("/var/www/app's", './vendor/bin/phpunit', "tests/Foo Bar's.php", null, null);
        assert.equal(
            cmd,
            "cd '/var/www/app'\\''s' && './vendor/bin/phpunit' 'tests/Foo Bar'\\''s.php'"
        );
    });

    test('escapes filter text as a shell argument', () => {
        const cmd = buildRemoteCommand('/var/www/app', './vendor/bin/phpunit', 'tests/FooTest.php', "Foo'Test", "testBar'sWorks");
        assert.equal(
            cmd,
            "cd '/var/www/app' && './vendor/bin/phpunit' --filter '^Foo'\\''Test::testBar'\\''sWorks$' 'tests/FooTest.php'"
        );
    });
});

describe('buildTerminalCommand', () => {
    test('quotes remote command and identity file for terminal fallback', () => {
        const cmd = buildTerminalCommand(
            {
                user: 'alice',
                host: 'server.example.com',
                port: 2222,
                identityFile: "/Users/alice/.ssh/dev key"
            },
            "cd '/var/www/app' && './vendor/bin/phpunit' 'tests/Foo Bar.php'"
        );

        assert.equal(
            cmd,
            String.raw`ssh -p 2222 -i '/Users/alice/.ssh/dev key' alice@server.example.com 'cd '\''/var/www/app'\'' && '\''./vendor/bin/phpunit'\'' '\''tests/Foo Bar.php'\'''`
        );
    });
});

// ── buildSshArgs ──────────────────────────────────────────────────────────────

describe('buildSshArgs', () => {
    const baseHost = { user: 'alice', host: 'server.example.com', port: 22 };
    const remoteCmd = "cd '/var/www/app' && './vendor/bin/phpunit'";

    test('uses BatchMode=yes when no saved password is available', () => {
        const { args } = buildSshArgs(baseHost, null, remoteCmd);
        assert.ok(args.includes('BatchMode=yes'), 'args should contain BatchMode=yes');
        const idx = args.indexOf('-o');
        assert.ok(idx !== -1, 'args should contain -o flag');
        assert.equal(args[idx + 1], 'BatchMode=yes');
    });

    test('always includes -p <port>', () => {
        const { args } = buildSshArgs(baseHost, null, remoteCmd);
        const idx = args.indexOf('-p');
        assert.ok(idx !== -1, 'args should contain -p flag');
        assert.equal(args[idx + 1], '22');
    });

    test('always includes user@host as target', () => {
        const { args } = buildSshArgs(baseHost, null, remoteCmd);
        assert.ok(args.includes('alice@server.example.com'));
    });

    test('remote command is last arg', () => {
        const { args } = buildSshArgs(baseHost, null, remoteCmd);
        assert.equal(args[args.length - 1], remoteCmd);
    });

    test('no auth: no -i flag, no SSH_ASKPASS in env', () => {
        const { args, env } = buildSshArgs(baseHost, null, remoteCmd);
        assert.ok(!args.includes('-i'), 'should not have -i when no identityFile');
        assert.ok(!env.SSH_ASKPASS, 'should not have SSH_ASKPASS when no password');
    });

    test('password auth: env includes SSH_ASKPASS, SSH_ASKPASS_REQUIRE, DISPLAY, _SSH_UI_PASS', () => {
        const { env } = buildSshArgs(baseHost, 'secret', remoteCmd);
        assert.ok(env.SSH_ASKPASS, 'should set SSH_ASKPASS');
        assert.equal(env.SSH_ASKPASS_REQUIRE, 'force');
        assert.ok(env.DISPLAY, 'should set DISPLAY');
        assert.equal(env._SSH_UI_PASS, 'secret');
    });

    test('password auth enables forced askpass instead of disabling password interaction', () => {
        const { args, cleanup } = buildSshArgs(baseHost, 'secret', remoteCmd);
        try {
            assert.ok(args.includes('BatchMode=no'));
            assert.ok(!args.includes('BatchMode=yes'));
        } finally {
            cleanup();
        }
    });

    test('password auth: askpass script file is created on disk', () => {
        const { env, cleanup } = buildSshArgs(baseHost, 'mypwd', remoteCmd);
        try {
            assert.ok(fs.existsSync(env.SSH_ASKPASS), `askpass script should exist at ${env.SSH_ASKPASS}`);
            const content = fs.readFileSync(env.SSH_ASKPASS, 'utf8');
            assert.ok(content.includes('_SSH_UI_PASS'), 'askpass script should echo _SSH_UI_PASS');
        } finally {
            cleanup();
        }
    });

    test('password auth: no -i flag in args', () => {
        const { args } = buildSshArgs(baseHost, 'secret', remoteCmd);
        assert.ok(!args.includes('-i'), 'password auth should not add -i');
    });

    test('key auth (identityFile): includes -i flag, no SSH_ASKPASS env', () => {
        const keyHost = { ...baseHost, identityFile: '/home/alice/.ssh/id_rsa' };
        const { args, env } = buildSshArgs(keyHost, null, remoteCmd);
        const idx = args.indexOf('-i');
        assert.ok(idx !== -1, 'should have -i flag');
        assert.equal(args[idx + 1], '/home/alice/.ssh/id_rsa');
        assert.ok(!env.SSH_ASKPASS, 'should not set SSH_ASKPASS for key auth');
    });

    test('encrypted key auth: includes -i and SSH_ASKPASS for the saved key passphrase', () => {
        const keyHost = { ...baseHost, identityFile: '/home/alice/.ssh/id_rsa' };
        const { args, env, cleanup } = buildSshArgs(keyHost, 'key-passphrase', remoteCmd);
        try {
            assert.ok(args.includes('-i'));
            assert.ok(env.SSH_ASKPASS, 'should provide askpass for an encrypted key');
            assert.equal(env._SSH_UI_PASS, 'key-passphrase');
        } finally {
            cleanup();
        }
    });

    test('key auth: -i comes before user@host', () => {
        const keyHost = { ...baseHost, identityFile: '/home/alice/.ssh/id_rsa' };
        const { args } = buildSshArgs(keyHost, null, remoteCmd);
        const iIdx = args.indexOf('-i');
        const targetIdx = args.indexOf('alice@server.example.com');
        assert.ok(iIdx < targetIdx, '-i should come before user@host');
    });

    test('port is converted to string in args', () => {
        const host = { ...baseHost, port: 2222 };
        const { args } = buildSshArgs(host, null, remoteCmd);
        const idx = args.indexOf('-p');
        assert.equal(typeof args[idx + 1], 'string');
        assert.equal(args[idx + 1], '2222');
    });
});
