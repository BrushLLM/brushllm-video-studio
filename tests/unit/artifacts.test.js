'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  identity, reservePath, publishFile, publishSequence, deleteArtifact
} = require('../../electron/engine/artifacts');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'brushvs-art-test-'));
}

function touch(filePath, content = 'data') {
  fs.writeFileSync(filePath, content);
}

// ── reservePath ───────────────────────────────────────────────────────────────

test('reservePath returns desired path when unoccupied', () => {
  const dir = makeTmp();
  const reserved = new Set();
  const desired = path.join(dir, 'out.mp4');
  const result = reservePath(desired, reserved);
  assert.equal(result, desired);
  assert.ok(reserved.has(desired));
});

test('reservePath skips slots already on disk', () => {
  const dir = makeTmp();
  const reserved = new Set();
  const desired = path.join(dir, 'out.mp4');
  touch(desired);
  const result = reservePath(desired, reserved);
  assert.notEqual(result, desired);
  assert.ok(path.basename(result).includes('out-1'), `expected -1 suffix, got ${path.basename(result)}`);
});

test('reservePath skips in-memory reserved slots', () => {
  const dir = makeTmp();
  const reserved = new Set();
  const desired = path.join(dir, 'out.mp4');
  reserved.add(desired);
  const result = reservePath(desired, reserved);
  assert.notEqual(result, desired);
  assert.ok(reserved.has(result));
});

// ── publishFile ───────────────────────────────────────────────────────────────

test('publishFile hard-links staged file to desired path', () => {
  const dir = makeTmp();
  const staged = path.join(dir, 'staged.mp4');
  touch(staged, 'content');
  const desired = path.join(dir, 'out.mp4');
  const art = publishFile(staged, desired);
  assert.equal(art.kind, 'file');
  assert.equal(art.outputPath, desired);
  assert.ok(fs.existsSync(desired));
  assert.equal(art.files.length, 1);
});

test('publishFile does not overwrite an existing file at desired path', () => {
  const dir = makeTmp();
  const staged = path.join(dir, 'staged.mp4');
  touch(staged, 'new content');
  const desired = path.join(dir, 'out.mp4');
  touch(desired, 'existing'); // slot 0 occupied
  const art = publishFile(staged, desired);
  assert.notEqual(art.outputPath, desired, 'must not clobber slot 0');
  assert.ok(art.outputPath.endsWith('-1.mp4'), `expected -1 suffix, got ${art.outputPath}`);
  assert.equal(fs.readFileSync(desired, 'utf8'), 'existing', 'slot 0 file must be untouched');
});

test('publishFile skips multiple occupied slots (simulates concurrent external creation)', () => {
  const dir = makeTmp();
  const staged = path.join(dir, 'staged.mp4');
  touch(staged, 'content');
  const desired = path.join(dir, 'out.mp4');
  touch(desired, 'slot0');
  touch(path.join(dir, 'out-1.mp4'), 'slot1');
  const art = publishFile(staged, desired);
  assert.ok(art.outputPath.endsWith('-2.mp4'), `expected slot 2, got ${art.outputPath}`);
});

test('publishFile throws on empty staged file', () => {
  const dir = makeTmp();
  const staged = path.join(dir, 'empty.mp4');
  fs.writeFileSync(staged, '');
  const desired = path.join(dir, 'out.mp4');
  assert.throws(() => publishFile(staged, desired), /empty output/i);
});

// ── publishSequence ───────────────────────────────────────────────────────────

test('publishSequence returns correct manifest structure', () => {
  const dir = makeTmp();
  for (let i = 1; i <= 3; i++) touch(path.join(dir, `frame${String(i).padStart(5, '0')}.png`), `f${i}`);
  const destDir = path.join(dir, 'frames_out');
  const art = publishSequence(path.join(dir, 'frame%05d.png'), destDir);
  assert.equal(art.kind, 'sequence');
  assert.equal(art.directory, destDir);
  assert.equal(art.outputPath, path.join(destDir, 'frame%05d.png'));
  assert.equal(art.files.length, 3);
  assert.ok(art.directoryIdentity, 'must carry directoryIdentity for later delete checks');
});

test('publishSequence does NOT touch non-matching files in the staged directory', () => {
  const dir = makeTmp();
  touch(path.join(dir, 'frame00001.png'), 'f1');
  touch(path.join(dir, 'frame00002.png'), 'f2');
  // These must survive untouched
  touch(path.join(dir, 'concat.txt'), 'concat data');
  touch(path.join(dir, 'other.mp4'), 'mp4 data');
  publishSequence(path.join(dir, 'frame%05d.png'), path.join(dir, 'frames_out'));
  assert.ok(fs.existsSync(path.join(dir, 'concat.txt')), 'concat.txt must not be deleted');
  assert.ok(fs.existsSync(path.join(dir, 'other.mp4')), 'other.mp4 must not be deleted');
});

test('publishSequence skips to next directory slot when slot-0 already exists', () => {
  const dir = makeTmp();
  touch(path.join(dir, 'frame00001.png'), 'f1');
  const destDir = path.join(dir, 'frames_out');
  fs.mkdirSync(destDir); // pre-occupy slot 0
  const art = publishSequence(path.join(dir, 'frame%05d.png'), destDir);
  assert.notEqual(art.directory, destDir);
  assert.ok(art.directory.endsWith('frames_out-1'), `expected -1 slot, got ${art.directory}`);
});

test('publishSequence with no %05d matches only the exact pattern name', () => {
  const dir = makeTmp();
  touch(path.join(dir, 'single.png'), 'data');
  touch(path.join(dir, 'other.png'), 'other');
  const art = publishSequence(path.join(dir, 'single.png'), path.join(dir, 'out'));
  assert.equal(art.files.length, 1, 'only the exact-name file should be matched');
});

test('publishSequence throws when no frames match the pattern', () => {
  const dir = makeTmp();
  touch(path.join(dir, 'unrelated.txt'), 'x');
  assert.throws(
    () => publishSequence(path.join(dir, 'frame%05d.png'), path.join(dir, 'out')),
    /no frames/i
  );
});

// ── deleteArtifact ────────────────────────────────────────────────────────────

test('deleteArtifact returns error when artifact is null', () => {
  const r = deleteArtifact(null, []);
  assert.equal(r.ok, false);
  assert.match(r.error, /no registered output/i);
});

test('deleteArtifact returns error when artifact.files is empty', () => {
  const r = deleteArtifact({ files: [] }, []);
  assert.equal(r.ok, false);
});

test('deleteArtifact deletes the published output file', () => {
  const dir = makeTmp();
  const staged = path.join(dir, 'staged.mp4');
  touch(staged, 'content');
  const desired = path.join(dir, 'out.mp4');
  const art = publishFile(staged, desired);
  const r = deleteArtifact(art, []);
  assert.equal(r.ok, true, r.error);
  assert.ok(!fs.existsSync(desired), 'output file must be removed');
});

test('deleteArtifact refuses to delete a modified output file', () => {
  const dir = makeTmp();
  const staged = path.join(dir, 'staged.mp4');
  touch(staged, 'content');
  const desired = path.join(dir, 'out.mp4');
  const art = publishFile(staged, desired);
  fs.writeFileSync(desired, 'tampered content');
  const r = deleteArtifact(art, []);
  assert.equal(r.ok, false);
  assert.match(r.error, /modified or replaced/i);
});

test('deleteArtifact refuses to delete a file listed as an input', () => {
  const dir = makeTmp();
  const inputPath = path.join(dir, 'input.mp4');
  touch(inputPath, 'input data');
  const art = { kind: 'file', outputPath: inputPath, files: [identity(inputPath)] };
  const r = deleteArtifact(art, [inputPath]);
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot delete an input/i);
});

test('deleteArtifact returns error when sequence directory was replaced', () => {
  const dir = makeTmp();
  touch(path.join(dir, 'frame00001.png'), 'f1');
  const destDir = path.join(dir, 'frames_out');
  const art = publishSequence(path.join(dir, 'frame%05d.png'), destDir);
  // Replace directory (different inode)
  fs.rmSync(destDir, { recursive: true });
  fs.mkdirSync(destDir);
  const r = deleteArtifact(art, []);
  assert.equal(r.ok, false);
  assert.match(r.error, /replaced/i);
});
