const { test } = require('node:test');
const assert = require('node:assert');
const subs = require('../../shared/subtitles');

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello world
Second line

2
00:00:05,000 --> 00:00:07,000
你好世界
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello world

00:00:05.000 --> 00:00:07.000
你好世界
`;

const ASS = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\i1}Hello{\\i0} world\\NSecond line
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,你好世界
`;

const TTML = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:01.000" end="00:00:03.500">Hello &amp; world</p>
      <p begin="00:00:05.000" end="00:00:07.000">你好世界<br/>第二行</p>
    </div>
  </body>
</tt>
`;

test('parses SRT', () => {
  const { cues, format } = subs.parse(SRT);
  assert.equal(format, 'srt');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1000);
  assert.equal(cues[0].end, 3500);
  assert.equal(cues[0].text, 'Hello world\nSecond line');
});

test('parses VTT with optional hours', () => {
  const { cues, format } = subs.parse(VTT);
  assert.equal(format, 'vtt');
  assert.equal(cues.length, 2);
  assert.equal(cues[1].start, 5000);
});

test('parses VTT with cue ids and NOTE blocks', () => {
  const vtt = `WEBVTT

NOTE this is a comment

intro-cue
00:01.000 --> 00:03.000
Hi
`;
  const { cues } = subs.parse(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Hi');
});

test('parses ASS stripping override tags and \\N', () => {
  const { cues, format } = subs.parse(ASS);
  assert.equal(format, 'ass');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello world\nSecond line');
  assert.equal(cues[1].text, '你好世界');
});

test('parses TTML with entities and br', () => {
  const { cues, format } = subs.parse(TTML);
  assert.equal(format, 'ttml');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'Hello & world');
  assert.equal(cues[1].text, '你好世界\n第二行');
});

test('parses TTML offset-time and dur forms', () => {
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="12.5s" end="15s">A</p><p begin="1.2s" dur="2s">B</p>
</div></body></tt>`;
  const { cues } = subs.parse(ttml);
  // Cues are sorted by start time: B (1.2s) comes first.
  assert.equal(cues[0].start, 1200);
  assert.equal(cues[0].end, 3200);
  assert.equal(cues[1].start, 12500);
  assert.equal(cues[1].end, 15000);
});

test('SRT roundtrip keeps timing and text', () => {
  const { cues } = subs.parse(SRT);
  const out = subs.write(cues, 'srt');
  const again = subs.parse(out);
  assert.deepEqual(again.cues, cues);
});

test('SRT -> VTT uses dot timecodes and header', () => {
  const { cues } = subs.parse(SRT);
  const out = subs.write(cues, 'vtt');
  assert.match(out, /^WEBVTT/);
  assert.match(out, /00:00:01\.000 --> 00:00:03\.500/);
  assert.equal(subs.parse(out).cues.length, 2);
});

test('SRT -> ASS writes Dialogue lines with \\N', () => {
  const { cues } = subs.parse(SRT);
  const out = subs.write(cues, 'ass');
  assert.match(out, /\[Events\]/);
  assert.match(out, /Dialogue: 0,0:00:01\.00,0:00:03\.50,Default,,0,0,0,,Hello world\\NSecond line/);
});

test('SRT -> SSA uses v4.00 and [V4 Styles]', () => {
  const { cues } = subs.parse(SRT);
  const out = subs.write(cues, 'ssa');
  assert.match(out, /ScriptType: v4\.00\b/);
  assert.match(out, /\[V4 Styles\]/);
});

test('SRT -> TTML roundtrips', () => {
  const { cues } = subs.parse(SRT);
  const out = subs.write(cues, 'ttml', { lang: 'zh' });
  assert.match(out, /xml:lang="zh"/);
  assert.match(out, /begin="00:00:01\.000"/);
  const back = subs.parse(out);
  assert.equal(back.format, 'ttml');
  assert.equal(back.cues[0].text, 'Hello world\nSecond line');
});

test('TTML escapes XML entities on write', () => {
  const out = subs.write([{ start: 0, end: 1000, text: 'a < b & "c"' }], 'ttml');
  assert.match(out, /a &lt; b &amp; &quot;c&quot;/);
});

test('ASS -> SRT strips tags and converts newlines', () => {
  const { cues } = subs.parse(ASS);
  const out = subs.write(cues, 'srt');
  assert.doesNotMatch(out, /\\\\i1/);
  assert.match(out, /Hello world\nSecond line/);
});

test('shiftCues moves times and clamps at zero', () => {
  const { cues } = subs.parse(SRT);
  const shifted = subs.shiftCues(cues, -1500);
  assert.equal(shifted[0].start, 0);
  assert.equal(shifted[0].end, 2000);
  assert.equal(shifted[1].start, 3500);
});

test('shiftCues drop removes fully-past cues', () => {
  const { cues } = subs.parse(SRT);
  const shifted = subs.shiftCues(cues, -6000, { drop: true });
  assert.equal(shifted.length, 1); // second cue survives partially
  assert.equal(shifted[0].start, 0);
  assert.equal(shifted[0].end, 1000);
});

test('detectFormat recognizes each format', () => {
  assert.equal(subs.detectFormat(SRT), 'srt');
  assert.equal(subs.detectFormat(VTT), 'vtt');
  assert.equal(subs.detectFormat(ASS), 'ass');
  assert.equal(subs.detectFormat(TTML), 'ttml');
});

test('decodeBuffer detects UTF-8 with and without BOM', () => {
  const plain = subs.decodeBuffer(Buffer.from(SRT, 'utf8'));
  assert.equal(plain.charset, 'utf-8');
  const bom = subs.decodeBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SRT, 'utf8')]));
  assert.equal(bom.charset, 'utf-8');
  assert.match(bom.text, /^1/);
});

test('decodeBuffer detects UTF-16LE with BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('WEBVTT\n\nhi', 'utf16le')]);
  const r = subs.decodeBuffer(buf);
  assert.equal(r.charset, 'utf-16le');
  assert.match(r.text, /WEBVTT/);
});

test('decodeBuffer detects GBK', () => {
  // "你好世界" encoded in GBK.
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]);
  const r = subs.decodeBuffer(gbk);
  assert.equal(r.charset, 'gbk');
  assert.equal(r.text, '你好世界');
});

test('convertBuffer GBK SRT -> UTF-8 VTT', () => {
  const srtGbk = Buffer.concat([
    Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n', 'latin1'),
    Buffer.from([0xc4, 0xe3, 0xba, 0xc3]) // 你好
  ]);
  const r = subs.convertBuffer(srtGbk, 'vtt');
  assert.equal(r.charset, 'gbk');
  assert.equal(r.cueCount, 1);
  assert.match(r.buffer.toString('utf8'), /你好/);
  assert.match(r.buffer.toString('utf8'), /WEBVTT/);
});

test('reencodeBuffer to UTF-8 BOM', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const r = subs.reencodeBuffer(gbk, 'utf-8bom');
  assert.equal(r.fromCharset, 'gbk');
  assert.equal(r.buffer[0], 0xef);
  assert.equal(r.buffer.toString('utf8').slice(1), '你好');
});

test('shiftBuffer shifts and keeps format', () => {
  const r = subs.shiftBuffer(Buffer.from(VTT, 'utf8'), 500);
  assert.match(r.buffer.toString('utf8'), /00:00:01\.500/);
});

test('extOfFormat maps formats', () => {
  assert.equal(subs.extOfFormat('srt'), '.srt');
  assert.equal(subs.extOfFormat('ttml'), '.ttml');
});

test('parseTimeToMs handles all time syntaxes', () => {
  assert.equal(subs.parseTimeToMs('00:00:01,500'), 1500);
  assert.equal(subs.parseTimeToMs('0:00:01.5'), 1500);
  assert.equal(subs.parseTimeToMs('01:02:03'), 3723000);
  assert.equal(subs.parseTimeToMs('02:03.5'), 123500);
  assert.equal(subs.parseTimeToMs('12.5s'), 12500);
  assert.equal(subs.parseTimeToMs('500ms'), 500);
});
