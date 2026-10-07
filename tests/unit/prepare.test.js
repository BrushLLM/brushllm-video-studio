const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareInputs } = require('../../electron/engine/prepare');
const subs = require('../../shared/subtitles');

function fixture(t, buffer, extension = '.ass') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-prepare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, `input${extension}`);
  const tmpDir = path.join(dir, 'job');
  fs.mkdirSync(tmpDir);
  fs.writeFileSync(input, buffer);
  return { input, tmpDir };
}

const ASS = '\uFEFF[Script Info]\r\nScriptType: v4.00+\r\nPlayResX: 1920\r\n'
  + '[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize\r\nStyle: Fancy,Serif,48\r\n'
  + '[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n'
  + 'Dialogue: 7,0:00:01.00,0:00:02.00,Fancy,actor,10,20,30,scroll,{\\pos(10,20)}Hello, world\r\n'
  + '[Fonts]\r\nfontname: example.ttf\r\nopaque-data';

test('prepare preserves an entire UTF-8 ASS file, including BOM and line endings', (t) => {
  const buf = Buffer.from(ASS);
  const { input, tmpDir } = fixture(t, buf);
  const result = prepareInputs('video.burnSubs', {}, ['video.mp4', input], tmpDir);
  assert.deepEqual(result, { inputs: ['video.mp4'], subFormats: ['ass'] });
  assert.deepEqual(fs.readFileSync(path.join(tmpDir, 'sub0.ass')), buf);
  assert.deepEqual(fs.readFileSync(input), buf);
});

test('prepare retains SSA contents and marks the ASS-family as styled for the command builder', (t) => {
  const ssa = ASS.replace('v4.00+', 'v4.00').replace('[V4+ Styles]', '[V4 Styles]')
    .replace('Format: Layer, Start', 'Format: Marked, Start').replace('Dialogue: 7,', 'Dialogue: Marked=1,');
  const { input, tmpDir } = fixture(t, Buffer.from(ssa), '.ssa');
  const result = prepareInputs('subtitle.mux', {}, ['video.mkv', input], tmpDir);
  assert.deepEqual(result, { inputs: ['video.mkv', 'sub0.ass'], subFormats: ['ass'] });
  assert.equal(fs.readFileSync(path.join(tmpDir, 'sub0.ass'), 'utf8'), ssa);
});

test('prepare only transcodes the encoding of non-UTF-8 ASS, without parse/write', (t) => {
  const text = ASS.replace(/^\uFEFF/, '');
  const original = subs.encodeText(text, 'utf-16be');
  const { input, tmpDir } = fixture(t, original);
  prepareInputs('subtitle.burn', {}, ['video.mp4', input], tmpDir);
  assert.equal(fs.readFileSync(path.join(tmpDir, 'sub0.ass'), 'utf8'), text);
  assert.deepEqual(fs.readFileSync(input), original);
});

test('prepare requires an explicit ambiguous source charset and leaves original input intact', (t) => {
  const original = Buffer.concat([
    Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n'),
    Buffer.from('a741a66e', 'hex')
  ]);
  const { input, tmpDir } = fixture(t, original, '.srt');
  assert.throws(() => prepareInputs('video.embedSubs', {}, ['video.mp4', input], tmpDir), { code: 'SUBTITLE_CHARSET_AMBIGUOUS' });
  assert.deepEqual(fs.readdirSync(tmpDir), []);
  prepareInputs('video.embedSubs', { sourceCharset: 'big5' }, ['video.mp4', input], tmpDir);
  assert.match(fs.readFileSync(path.join(tmpDir, 'sub0.srt'), 'utf8'), /你好/);
  assert.deepEqual(fs.readFileSync(input), original);
});

test('prepare rejects unsupported TTML instead of writing an empty subtitle', (t) => {
  const original = Buffer.from(`<tt><body timeContainer='seq'><p dur='1s'>X</p></body></tt>`);
  const { input, tmpDir } = fixture(t, original, '.ttml');
  assert.throws(() => prepareInputs('video.burnSubs', {}, ['video.mp4', input], tmpDir), { code: 'SUBTITLE_UNSUPPORTED_TTML' });
  assert.deepEqual(fs.readdirSync(tmpDir), []);
  assert.deepEqual(fs.readFileSync(input), original);
});

test('prepare passes unrelated operations through without reading paths', () => {
  const inputs = ['nonexistent.mp4'];
  assert.deepEqual(prepareInputs('video.convert', {}, inputs, '/nonexistent'), { inputs, subFormats: [] });
});
