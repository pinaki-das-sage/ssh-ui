// Purpose: Defines repository-wide JavaScript linting for the VS Code extension and unit tests.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const js = require('@eslint/js');

module.exports = [
    {
        ignores: ['node_modules/**', 'agent-output/**', '.vscode-test/**'],
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                Buffer: 'readonly',
                __dirname: 'readonly',
                clearInterval: 'readonly',
                clearTimeout: 'readonly',
                console: 'readonly',
                module: 'readonly',
                process: 'readonly',
                require: 'readonly',
                setInterval: 'readonly',
                setTimeout: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
        },
    },
];
