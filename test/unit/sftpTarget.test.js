// Purpose: Tests the user-visible label for the selected SFTP target.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { formatSftpTargetLabel } = require('../../src/sftpTarget');

describe('formatSftpTargetLabel', () => {
    test('uses the compact RT prefix for a selected target', () => {
        assert.equal(formatSftpTargetLabel('p308-webui'), 'RT-p308-webui');
    });

    test('prompts for target selection when none is selected', () => {
        assert.equal(formatSftpTargetLabel(null), 'RT-Select target');
    });
});
