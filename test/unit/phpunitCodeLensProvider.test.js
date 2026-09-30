// Purpose: Tests pure PHPUnit CodeLens detection without a VS Code host.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// The module under test — does not exist yet (TDD: expect failure)
const { findTestItems } = require('../../src/phpunitCodeLensProvider');

describe('findTestItems', () => {
    test('returns empty array for non-test PHP file', () => {
        const text = `<?php\nclass MyService {\n    public function doWork() {}\n}\n`;
        const items = findTestItems(text);
        assert.deepEqual(items, []);
    });

    test('detects class extending TestCase', () => {
        const text = `<?php\nclass FooTest extends TestCase {\n    public function testBarWorks() {}\n}\n`;
        const items = findTestItems(text);
        const classItem = items.find(i => i.type === 'class');
        assert.ok(classItem, 'should detect a class item');
        assert.equal(classItem.className, 'FooTest');
        assert.equal(classItem.line, 1); // 0-based line index
    });

    test('detects class extending fully qualified PHPUnit TestCase', () => {
        const text = `<?php\nclass BarTest extends \\PHPUnit\\Framework\\TestCase {\n    public function testSomething() {}\n}\n`;
        const items = findTestItems(text);
        const classItem = items.find(i => i.type === 'class');
        assert.ok(classItem, 'should detect fully qualified TestCase');
        assert.equal(classItem.className, 'BarTest');
    });

    test('detects public function test* method', () => {
        const text = `<?php\nclass FooTest extends TestCase {\n    public function testUserCanLogin() {\n        // test body\n    }\n}\n`;
        const items = findTestItems(text);
        const methodItem = items.find(i => i.type === 'method' && i.methodName === 'testUserCanLogin');
        assert.ok(methodItem, 'should detect test method by name prefix');
        assert.equal(methodItem.className, 'FooTest');
        assert.equal(methodItem.line, 2); // 0-based
    });

    test('detects method annotated with #[Test] attribute', () => {
        const text = `<?php\nclass FooTest extends TestCase {\n    #[Test]\n    public function itDoesAThing() {\n    }\n}\n`;
        const items = findTestItems(text);
        const methodItem = items.find(i => i.type === 'method' && i.methodName === 'itDoesAThing');
        assert.ok(methodItem, 'should detect #[Test] annotated method');
        assert.equal(methodItem.className, 'FooTest');
    });

    test('detects multiple test methods in same class', () => {
        const text = [
            '<?php',
            'class FooTest extends TestCase {',
            '    public function testFirst() {}',
            '    public function testSecond() {}',
            '}',
        ].join('\n');
        const items = findTestItems(text);
        const methods = items.filter(i => i.type === 'method');
        assert.equal(methods.length, 2);
        assert.ok(methods.find(m => m.methodName === 'testFirst'));
        assert.ok(methods.find(m => m.methodName === 'testSecond'));
    });

    test('does not detect non-test public function (no test prefix, no #[Test])', () => {
        const text = `<?php\nclass FooTest extends TestCase {\n    public function setUp() {}\n    public function tearDown() {}\n}\n`;
        const items = findTestItems(text);
        const methods = items.filter(i => i.type === 'method');
        assert.equal(methods.length, 0, 'setUp/tearDown should not be detected as test methods');
    });

    test('does not detect class without TestCase extension', () => {
        const text = `<?php\nclass MyHelper {\n    public function testHelperMethod() {}\n}\n`;
        const items = findTestItems(text);
        // No class item because it doesn't extend TestCase
        const classItem = items.find(i => i.type === 'class');
        assert.ok(!classItem, 'should not detect class without TestCase parent');
        // No method items either, since we're not in a test class
        assert.equal(items.filter(i => i.type === 'method').length, 0);
    });

    test('each item has line, type, className, and methodName (null for class items)', () => {
        const text = `<?php\nclass FooTest extends TestCase {\n    public function testFoo() {}\n}\n`;
        const items = findTestItems(text);
        for (const item of items) {
            assert.ok('line' in item, 'item should have line');
            assert.ok('type' in item, 'item should have type');
            assert.ok('className' in item, 'item should have className');
            assert.ok('methodName' in item, 'item should have methodName');
        }
        const classItem = items.find(i => i.type === 'class');
        assert.equal(classItem.methodName, null);
    });

    test('#[Test] attribute line number points to the method line, not the attribute line', () => {
        const text = [
            '<?php',
            'class FooTest extends TestCase {',
            '    #[Test]',
            '    public function itShouldWork() {}',
            '}',
        ].join('\n');
        const items = findTestItems(text);
        const methodItem = items.find(i => i.type === 'method');
        assert.ok(methodItem, 'should find method');
        // CodeLens should appear on the #[Test] attribute line (line 2, 0-based)
        assert.equal(methodItem.line, 2);
    });
});
