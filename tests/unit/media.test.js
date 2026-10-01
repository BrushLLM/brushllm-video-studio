const { test } = require('node:test');
const assert = require('node:assert');

let media;
test.before(async () => {
  media = await import('../../shared/media.mjs');
});

test('known extensions map to their kind', () => {
  assert.equal(media.fileKindOf('movie.mp4'), 'video');
  assert.equal(media.fileKindOf('song.flac'), 'audio');
  assert.equal(media.fileKindOf('subs.ass'), 'subtitle');
  assert.equal(media.fileKindOf('captions.TTML'), 'subtitle');
});

test('unknown extensions are NOT silently treated as video', () => {
  assert.equal(media.fileKindOf('archive.zip'), 'other');
  assert.equal(media.fileKindOf('document.pdf'), 'other');
  assert.equal(media.fileKindOf('noextension'), 'other');
});

test('video page rejects audio and subtitle files', () => {
  const { accepted, rejected } = media.filterForSection(['/a.mp4', '/b.mp3', '/c.srt'], 'video');
  assert.deepEqual(accepted, ['/a.mp4']);
  assert.deepEqual(rejected, ['/b.mp3', '/c.srt']);
});

test('audio page accepts audio and video files, rejects subtitles', () => {
  const { accepted, rejected } = media.filterForSection(['/a.mp4', '/b.mp3', '/c.srt'], 'audio');
  assert.deepEqual(accepted, ['/a.mp4', '/b.mp3']);
  assert.deepEqual(rejected, ['/c.srt']);
});

test('subtitle page accepts subtitle and video files, rejects audio', () => {
  const { accepted, rejected } = media.filterForSection(['/a.mp4', '/b.srt', '/c.mp3'], 'subtitle');
  assert.deepEqual(accepted, ['/a.mp4', '/b.srt']);
  assert.deepEqual(rejected, ['/c.mp3']);
});

test('inputFilesForOp filters by the op input kind', () => {
  const files = [
    { path: '/a.mp4', kind: 'video' },
    { path: '/b.mp3', kind: 'audio' },
    { path: '/c.srt', kind: 'subtitle' }
  ];
  assert.equal(media.inputFilesForOp(files, 'video').length, 1);
  assert.equal(media.inputFilesForOp(files, 'audio').length, 1);
  assert.equal(media.inputFilesForOp(files, 'subtitle').length, 1);
  assert.equal(media.inputFilesForOp(files, 'any').length, 3);
  assert.equal(media.inputFilesForOp(files, undefined).length, 3);
});
