// Purpose: Tests node-pty guards, terminal dimensions, and Windows OpenSSH resolution.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const sshPty = require('../../src/sshPty');

describe('sshPty', () => {
    test('exposes isAvailable, lastLoadError, and createReconnectingSshPty', () => {
        assert.equal(typeof sshPty.isAvailable, 'function');
        assert.equal(typeof sshPty.lastLoadError, 'function');
        assert.equal(typeof sshPty.createReconnectingSshPty, 'function');
    });

    test('isAvailable returns a boolean without throwing', () => {
        const result = sshPty.isAvailable();
        assert.equal(typeof result, 'boolean');
    });

    test('createReconnectingSshPty throws a clear error when node-pty is unavailable', () => {
        if (sshPty.isAvailable()) {
            // node-pty loaded successfully in this environment — nothing to assert here,
            // the fallback path is only reachable when the native module fails to load.
            return;
        }
        assert.throws(() => sshPty.createReconnectingSshPty({ name: 'test' }, ['-tt'], {}));
    });
});

describe('isValidSize', () => {
    test('accepts VS Code TerminalDimensions and normalizes columns for node-pty', () => {
        const dimensions = { columns: 132, rows: 42 };

        assert.equal(sshPty.isValidSize(dimensions), true);
        assert.deepEqual(sshPty.normalizeTerminalDimensions(dimensions), { cols: 132, rows: 42 });
    });

    test('accepts positive finite cols/rows', () => {
        assert.equal(sshPty.isValidSize({ cols: 80, rows: 24 }), true);
    });

    test('rejects zero cols or rows', () => {
        assert.equal(sshPty.isValidSize({ cols: 0, rows: 24 }), false);
        assert.equal(sshPty.isValidSize({ cols: 80, rows: 0 }), false);
    });

    test('rejects negative cols or rows', () => {
        assert.equal(sshPty.isValidSize({ cols: -1, rows: 24 }), false);
    });

    test('rejects undefined cols or rows (VS Code initial layout event)', () => {
        assert.equal(sshPty.isValidSize({ cols: undefined, rows: 24 }), false);
        assert.equal(sshPty.isValidSize({ cols: 80, rows: undefined }), false);
    });

    test('rejects NaN cols or rows', () => {
        assert.equal(sshPty.isValidSize({ cols: NaN, rows: 24 }), false);
    });

    test('rejects null or undefined dimensions object', () => {
        assert.equal(sshPty.isValidSize(null), false);
        assert.equal(sshPty.isValidSize(undefined), false);
    });
});

describe('resolveSshExecutable', () => {
    test('uses Windows OpenSSH by absolute path without consulting PATH', () => {
        const expected = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
        const executable = sshPty.resolveSshExecutable(
            'win32',
            { SystemRoot: 'C:\\Windows' },
            candidate => candidate === expected
        );
        assert.equal(executable, expected);
    });

    test('falls back to the normal Windows executable name when OpenSSH is not installed', () => {
        const executable = sshPty.resolveSshExecutable(
            'win32',
            { SystemRoot: 'C:\\Windows' },
            () => false
        );
        assert.equal(executable, 'ssh.exe');
    });

    test('keeps the existing SSH command name on non-Windows platforms', () => {
        assert.equal(sshPty.resolveSshExecutable('darwin', {}, () => false), 'ssh');
    });
});

describe('hasWindowsOpenSsh', () => {
    test('reports Windows OpenSSH only when its system executable exists', () => {
        const exists = candidate => candidate === 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
        assert.equal(sshPty.hasWindowsOpenSsh('win32', { SystemRoot: 'C:\\Windows' }, exists), true);
        assert.equal(sshPty.hasWindowsOpenSsh('win32', { SystemRoot: 'C:\\Windows' }, () => false), false);
    });

    test('does not require Windows OpenSSH on non-Windows platforms', () => {
        assert.equal(sshPty.hasWindowsOpenSsh('linux', {}, () => false), true);
    });
});

describe('isReconnectEnabled', () => {
    test('accepts the concise boolean configuration', () => {
        assert.equal(sshPty.isReconnectEnabled(true), true);
    });

    test('does not enable the unreleased nested configuration', () => {
        assert.equal(sshPty.isReconnectEnabled({ enabled: true }), false);
    });

    test('does not enable reconnect for false, missing, or malformed values', () => {
        assert.equal(sshPty.isReconnectEnabled(false), false);
        assert.equal(sshPty.isReconnectEnabled(undefined), false);
        assert.equal(sshPty.isReconnectEnabled({ enabled: false }), false);
    });
});
