// Purpose: Tests deterministic PHPUnit host selection rules.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Module under test — does not exist yet (TDD: expect MODULE_NOT_FOUND)
const { pickHost, resolvePhpunitHost } = require('../../src/phpunitRunner');

const hosts = [
    { name: 'p308-webui', user: 'alice', host: 'p308.example.com', port: 22 },
    { name: 'p309-webui', user: 'alice', host: 'p309.example.com', port: 22 },
];

describe('pickHost', () => {
    test('returns null when no enabled hosts', () => {
        assert.equal(pickHost([], null, null), null);
    });

    test('returns the single host when only one enabled, no default needed', () => {
        assert.deepEqual(pickHost([hosts[0]], null, null), hosts[0]);
    });

    test('uses default host when set and valid', () => {
        assert.deepEqual(pickHost(hosts, 'p309-webui', null), hosts[1]);
    });

    test('ignores stale default (host removed) and returns null to prompt', () => {
        assert.equal(pickHost(hosts, 'old-gone-server', null), null);
    });

    test('tree item name takes priority over default', () => {
        assert.deepEqual(pickHost(hosts, 'p309-webui', 'p308-webui'), hosts[0]);
    });

    test('tree item name match returns that host regardless of default', () => {
        assert.deepEqual(pickHost(hosts, null, 'p309-webui'), hosts[1]);
    });

    test('multiple hosts, no default, no tree item → returns null (needs prompt)', () => {
        assert.equal(pickHost(hosts, null, null), null);
    });

    test('multiple hosts, single match on default → returns default', () => {
        assert.deepEqual(pickHost(hosts, 'p308-webui', null), hosts[0]);
    });
});

describe('resolvePhpunitHost', () => {
    test('uses the selected SFTP target before the legacy PHPUnit default', () => {
        assert.deepEqual(
            resolvePhpunitHost(hosts, 'p308-webui', 'p309-webui', null),
            hosts[0]
        );
    });

    test('uses the legacy PHPUnit default when the selected SFTP target is not PHPUnit-enabled', () => {
        assert.deepEqual(
            resolvePhpunitHost(hosts, 'sftp-only-host', 'p309-webui', null),
            hosts[1]
        );
    });

    test('keeps an explicit tree-view host choice ahead of the selected SFTP target', () => {
        assert.deepEqual(
            resolvePhpunitHost(hosts, 'p308-webui', 'p309-webui', 'p309-webui'),
            hosts[1]
        );
    });
});
