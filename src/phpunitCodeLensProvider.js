// Purpose: Provides PHPUnit file and method CodeLens actions for PHP test files.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved
//
// findTestItems() is a pure function exported for unit testing without VS Code.

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Pure detection logic (testable without VS Code)
// ─────────────────────────────────────────────────────────────────────────────

// Matches: class FooTest extends TestCase  or  extends \PHPUnit\Framework\TestCase
const CLASS_REGEX = /^class\s+(\w+)\s+extends\s+(?:\\?PHPUnit\\Framework\\)?TestCase\b/;
// Matches: public function testFoo(
const TEST_METHOD_REGEX = /^\s+public\s+function\s+(test\w+)\s*\(/;
// Matches: #[Test]
const TEST_ATTRIBUTE_REGEX = /^\s*#\[Test\]/;
// Matches any public function (used after #[Test] attribute)
const PUBLIC_FUNC_REGEX = /^\s+public\s+function\s+(\w+)\s*\(/;

/**
 * Scan PHP source text and return an array of test item descriptors.
 *
 * Each item has:
 *   { type: 'class'|'method', line: number, className: string, methodName: string|null }
 *
 * Line numbers are 0-based (matching VS Code's Position API).
 *
 * @param {string} text  Full content of a PHP source file
 * @returns {Array<{type: string, line: number, className: string, methodName: string|null}>}
 */
function findTestItems(text) {
    const lines = text.split('\n');
    const items = [];
    let currentClassName = null;
    let pendingAttributeLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Class declaration extending TestCase
        const classMatch = line.match(CLASS_REGEX);
        if (classMatch) {
            currentClassName = classMatch[1];
            items.push({ type: 'class', line: i, className: currentClassName, methodName: null });
            pendingAttributeLine = -1;
            continue;
        }

        // #[Test] attribute — remember this line, apply to the next public function
        if (TEST_ATTRIBUTE_REGEX.test(line)) {
            pendingAttributeLine = i;
            continue;
        }

        // Line following a #[Test] attribute
        if (pendingAttributeLine !== -1) {
            const funcMatch = line.match(PUBLIC_FUNC_REGEX);
            if (funcMatch && currentClassName) {
                items.push({
                    type: 'method',
                    line: pendingAttributeLine,
                    className: currentClassName,
                    methodName: funcMatch[1],
                });
            }
            pendingAttributeLine = -1;
            continue;
        }

        // public function test*() method
        if (currentClassName) {
            const methodMatch = line.match(TEST_METHOD_REGEX);
            if (methodMatch) {
                items.push({
                    type: 'method',
                    line: i,
                    className: currentClassName,
                    methodName: methodMatch[1],
                });
            }
        }
    }

    return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// VS Code CodeLensProvider
// ─────────────────────────────────────────────────────────────────────────────

class PhpUnitCodeLensProvider {
    /**
     * @param {() => object[]} getEnabledHosts  Returns array of phpunit-enabled host configs
     */
    constructor(getEnabledHosts) {
        this._getEnabledHosts = getEnabledHosts;
    }

    /**
     * @param {import('vscode').TextDocument} document
     * @returns {import('vscode').CodeLens[]}
     */
    provideCodeLenses(document) {
        if (this._getEnabledHosts().length === 0) {
            return [];
        }

        const vscode = require('vscode');
        const text = document.getText();
        const items = findTestItems(text);
        const lenses = [];

        for (const item of items) {
            const range = new vscode.Range(item.line, 0, item.line, 0);

            if (item.type === 'class') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '\u25b6 Run File',
                    command: 'ssh-ui.runPhpunitFile',
                    arguments: [document.uri.fsPath],
                }));
            } else if (item.type === 'method') {
                lenses.push(new vscode.CodeLens(range, {
                    title: '\u25b6 Run Test',
                    command: 'ssh-ui.runPhpunitMethod',
                    arguments: [document.uri.fsPath, item.className, item.methodName],
                }));
            }
        }

        return lenses;
    }
}

module.exports = { findTestItems, PhpUnitCodeLensProvider };
