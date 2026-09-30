// Purpose: Tests pure SFTP sync decisions and local file collection.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    shouldIgnore,
    needsUpload,
    shouldUploadOnSave,
    collectLocalFiles,
} = require('../../src/sftpSync');

describe('shouldIgnore', () => {
    test('matches an ignored top-level folder name', () => {
        assert.equal(shouldIgnore('node_modules/foo.js', ['node_modules']), true);
    });

    test('matches an ignored folder name nested deeper in the path', () => {
        assert.equal(shouldIgnore('src/node_modules/foo.js', ['node_modules']), true);
    });

    test('matches an ignored dotfile folder', () => {
        assert.equal(shouldIgnore('.git/HEAD', ['.git']), true);
    });

    test('does not match a partial/substring name', () => {
        assert.equal(shouldIgnore('node_modules_extra/foo.js', ['node_modules']), false);
    });

    test('does not match unrelated files', () => {
        assert.equal(shouldIgnore('src/index.js', ['.vscode', '.git', 'node_modules']), false);
    });

    test('matches the file itself, not just directories', () => {
        assert.equal(shouldIgnore('.env', ['.env']), true);
    });

    test('empty or missing ignore list matches nothing', () => {
        assert.equal(shouldIgnore('src/index.js', []), false);
        assert.equal(shouldIgnore('src/index.js', undefined), false);
    });
});

describe('needsUpload', () => {
    test('mirror mode always uploads regardless of mtime', () => {
        assert.equal(needsUpload('mirror', 1000, 2000), true);
    });

    test('update mode uploads when remote does not exist', () => {
        assert.equal(needsUpload('update', 1000, null), true);
    });

    test('update mode uploads when local is newer than remote', () => {
        assert.equal(needsUpload('update', 2000, 1000), true);
    });

    test('update mode skips when remote is newer or equal', () => {
        assert.equal(needsUpload('update', 1000, 2000), false);
        assert.equal(needsUpload('update', 1000, 1000), false);
    });

    test('defaults to update semantics when syncMode is missing', () => {
        assert.equal(needsUpload(undefined, 1000, null), true);
        assert.equal(needsUpload(undefined, 1000, 2000), false);
    });
});

describe('shouldUploadOnSave', () => {
    test('always uploads on a manual save', () => {
        assert.equal(shouldUploadOnSave(true, false), true);
        assert.equal(shouldUploadOnSave(true, true), true);
    });

    test('skips autosave when uploadOnAutoSave is not enabled', () => {
        assert.equal(shouldUploadOnSave(false, false), false);
        assert.equal(shouldUploadOnSave(false, undefined), false);
    });

    test('uploads on autosave when uploadOnAutoSave is enabled', () => {
        assert.equal(shouldUploadOnSave(false, true), true);
    });
});

describe('collectLocalFiles', () => {
    function makeTempTree() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-sync-test-'));
        fs.mkdirSync(path.join(root, 'src'));
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.mkdirSync(path.join(root, '.git'));
        fs.writeFileSync(path.join(root, 'src', 'index.js'), 'console.log(1);');
        fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
        fs.writeFileSync(path.join(root, 'README.md'), '# demo');
        return root;
    }

    test('returns all files with workspace-relative posix paths', () => {
        const root = makeTempTree();
        const files = collectLocalFiles(root, []);
        const relPaths = files.map(f => f.relativePath).sort();
        assert.deepEqual(relPaths, ['.git/HEAD', 'README.md', 'node_modules/dep.js', 'src/index.js']);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('excludes ignored folders entirely, including their contents', () => {
        const root = makeTempTree();
        const files = collectLocalFiles(root, ['node_modules', '.git']);
        const relPaths = files.map(f => f.relativePath).sort();
        assert.deepEqual(relPaths, ['README.md', 'src/index.js']);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('each entry includes an absolutePath and a numeric mtimeMs', () => {
        const root = makeTempTree();
        const files = collectLocalFiles(root, ['node_modules', '.git']);
        for (const file of files) {
            assert.ok(fs.existsSync(file.absolutePath));
            assert.equal(typeof file.mtimeMs, 'number');
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
});
