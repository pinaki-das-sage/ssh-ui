// Purpose: Formats the selected SFTP target for consistent VS Code status-bar display.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

function formatSftpTargetLabel(targetName) {
    return targetName ? `RT-${targetName}` : 'RT-Select target';
}

module.exports = { formatSftpTargetLabel };
