// Purpose: Restores executable permission to node-pty helpers during install and packaging.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved
'use strict';

const fs = require('fs');
const path = require('path');

const candidates = [
    'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
    'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
    'node_modules/node-pty/prebuilds/linux-x64/spawn-helper',
    'node_modules/node-pty/prebuilds/linux-arm64/spawn-helper',
];

for (const relativePath of candidates) {
    const fullPath = path.join(__dirname, '..', relativePath);
    if (fs.existsSync(fullPath)) {
        fs.chmodSync(fullPath, 0o755);
        console.log(`Fixed executable permission: ${relativePath}`);
    }
}
