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
  const r = subs.convertBuffer(srtGbk, 'vtt', { sourceCharset: 'gbk' });
  assert.equal(r.charset, 'gbk');
  assert.equal(r.cueCount, 1);
  assert.match(r.buffer.toString('utf8'), /你好/);
  assert.match(r.buffer.toString('utf8'), /WEBVTT/);
});

test('reencodeBuffer to UTF-8 BOM', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const r = subs.reencodeBuffer(gbk, 'utf-8bom', { sourceCharset: 'gbk' });
  assert.equal(r.fromCharset, 'gbk');
  assert.equal(r.buffer[0], 0xef);
  assert.equal(r.buffer.toString('utf8').slice(1), '你好');
});

test('shiftBuffer shifts and keeps format', () => {
  const r = subs.shiftBuffer(Buffer.from(VTT, 'utf8'), 500);
  assert.match(r.buffer.toString('utf8'), /00:00:01\.500/);
});

const STYLED_ASS = '\uFEFF[Script Info]\r\nScriptType: v4.00+\r\nPlayResX: 1920\r\n'
  + '\r\n[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize\r\nStyle: Fancy,Serif,48\r\n'
  + '\r\n[Events]\r\nFormat: End, Layer, Start, Mystery, Style, Text\r\n'
  + '  Dialogue:  0:00:03.50 ,7, 0:00:01.00 ,untouched,Fancy,{\\pos(10,20)\\i1}Hello, world\\NBye  \r\n'
  + 'Comment: 0:00:04.00,9,0:00:02.00,keep,Fancy,comment, with commas\r\n'
  + '; opaque event metadata\r\n[Fonts]\r\nfontname: example.ttf\r\nopaque-data';

const SSA = '[Script Info]\r\nScriptType: v4.00\r\n[V4 Styles]\r\n'
  + 'Format: Name, Fontname, Fontsize\r\nStyle: Old,Arial,30\r\n[Events]\r\n'
  + 'Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\n'
  + 'Dialogue: Marked=1,0:00:01.00,0:00:03.00,Old,actor,10,20,30,scroll,{\\an8}A,B';

test('ASS shift changes only event times, preserving BOM, CRLF, unknown fields and styling', () => {
  const result = subs.shiftBuffer(Buffer.from(STYLED_ASS), 500);
  const expected = STYLED_ASS.replace('0:00:03.50', '0:00:04.00')
    .replace('0:00:01.00', '0:00:01.50')
    .replace('Comment: 0:00:04.00', 'Comment: 0:00:04.50')
    .replace('9,0:00:02.00', '9,0:00:02.50');
  assert.equal(result.buffer.toString('utf8'), expected);
  assert.equal(result.cueCount, 1);
  assert.equal(subs.shiftBuffer(Buffer.from(STYLED_ASS), 0).buffer.toString(), STYLED_ASS);
});

test('SSA shift preserves its original structure instead of generating ASS', () => {
  assert.equal(subs.detectFormat(SSA), 'ssa');
  const shifted = subs.shiftBuffer(Buffer.from(SSA), -1500);
  assert.equal(shifted.buffer.toString(), SSA.replace('0:00:01.00', '0:00:00.00').replace('0:00:03.00', '0:00:01.50'));
});

test('ASS drop removes only elapsed Dialogue lines, leaving other document lines intact', () => {
  const shifted = subs.shiftBuffer(Buffer.from(STYLED_ASS), -4000, { drop: true });
  const expected = STYLED_ASS.split(/(?<=\n)/).filter((line) => !line.includes('Dialogue:')).join('')
    .replace('Comment: 0:00:04.00', 'Comment: 0:00:00.00').replace('9,0:00:02.00', '9,0:00:00.00');
  assert.equal(shifted.buffer.toString(), expected);
  assert.equal(shifted.cueCount, 0);
});

test('ASS malformed event layouts/times reject rather than silently losing events', () => {
  for (const text of [
    ASS.replace('0:00:01.00', 'bad'),
    ASS.replace('Effect, Text', 'Text, Effect'),
    ASS.replace('Start, End', 'Start, Start'),
    '[Events]\nDialogue: 0,bad,0:00:03.50,Default,,0,0,0,,lost'
  ]) assert.throws(() => subs.shiftBuffer(Buffer.from(text), 500), { code: 'SUBTITLE_PARSE_ERROR' });
});

test('ASS writer preserves commas, translates simple markup and escapes literal override syntax', () => {
  const out = subs.writeAss([{ start: 0, end: 1000, text: '<i>Hello, <b>world</b></i>\n&lt;literal&gt; {x} \\N' }]);
  assert.match(out, /\{\\i1\}Hello, \{\\b1\}world\{\\b0\}\{\\i0\}\\N/);
  assert.match(out, /<literal>/);
  assert.match(out, /\\\{x\\\}/);
  assert.match(out, /\\\\N/);
  assert.equal(subs.parseAss(out)[0].text, 'Hello, world\n<literal> {x} \\N');
});

test('SSA writer uses SSA style and event field layouts', () => {
  const out = subs.write(subs.parseSrt(SRT), 'ssa');
  assert.match(out, /Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text/);
  assert.match(out, /Dialogue: Marked=0,/);
  assert.match(out, /TertiaryColour, BackColour/);
  assert.match(out, /AlphaLevel, Encoding/);
  assert.doesNotMatch(out, /OutlineColour|ScaleX|\[V4\+ Styles\]/);
  assert.equal(subs.parseAss(out)[0].text, 'Hello world\nSecond line');
});

test('same-format ASS/SSA conversion preserves the document', () => {
  assert.equal(subs.convertBuffer(Buffer.from(STYLED_ASS), 'ass').buffer.toString(), STYLED_ASS);
  assert.equal(subs.convertBuffer(Buffer.from(SSA), 'ssa').buffer.toString(), SSA);
});

test('TTML handles namespace prefixes, either quote style, minutes and parent offsets', () => {
  const text = `<t:tt xmlns:t='http://www.w3.org/ns/ttml'><t:body begin='10s'><t:div begin="1m"><t:p begin='1s' dur='2s'>A<t:span>B</t:span><t:br/>C</t:p></t:div></t:body></t:tt>`;
  assert.equal(subs.detectFormat(text), 'ttml');
  assert.deepEqual(subs.parseTtml(text), [{ start: 71000, end: 73000, text: 'AB\nC' }]);
});

test('TTML handles frame clocks, frame offsets, subframes, multipliers and tick rates', () => {
  const text = `<tt xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate='25' ttp:subFrameRate='2' ttp:tickRate='100'><body><div>
    <p begin='00:00:01:10.1' end='40f'>F</p><p begin='200t' dur='50t'>T</p>
  </div></body></tt>`;
  assert.deepEqual(subs.parseTtml(text), [{ start: 1420, end: 1600, text: 'F' }, { start: 2000, end: 2500, text: 'T' }]);
  const ntsc = `<tt xmlns:ttp='http://www.w3.org/ns/ttml#parameter' ttp:frameRate='30' ttp:frameRateMultiplier='1000 1001'><body><p begin='30f' dur='30f'>N</p></body></tt>`;
  assert.deepEqual(subs.parseTtml(ntsc), [{ start: 1001, end: 2002, text: 'N' }]);
  const ticks = `<tt><body><p begin='1t' end='2t'>T</p></body></tt>`;
  assert.deepEqual(subs.parseTtml(ticks), [{ start: 1000, end: 2000, text: 'T' }]);
});

test('TTML inherits parent timing and clips cues to the parent active interval', () => {
  const text = `<tt><body begin='10s' end='20s'><div begin='2s' dur='4s'>
    <p begin='1s' end='9s'>A</p><p>B</p>
  </div></body></tt>`;
  assert.deepEqual(subs.parseTtml(text), [{ start: 12000, end: 16000, text: 'B' }, { start: 13000, end: 16000, text: 'A' }]);
});

test('TTML handles comments, CDATA, XML entities and xml:space', () => {
  const text = `<tt><body><p begin='0s' end='1s'>a<!--comment--><![CDATA[<b>]]> &#x4F60;&#22909; &amp; &apos; &quot;</p><p begin='1s' end='2s' xml:space='preserve'> x  y </p></body></tt>`;
  assert.equal(subs.parseTtml(text)[0].text, `a<b> 你好 & ' "`);
  assert.equal(subs.parseTtml(text)[1].text, ' x  y ');
});

test('TTML rejects malformed XML, unsafe declarations and unsupported timing instead of empty success', () => {
  const cases = [
    `<tt><body><p begin='1s' end='2s'>X</body></tt>`,
    `<!DOCTYPE tt [<!ENTITY x SYSTEM 'file:///secret'>]><tt><body><p begin='0s' end='1s'>&x;</p></body></tt>`,
    `<tt><body><p begin='0s' end='1s'>&unknown;</p></body></tt>`,
    `<tt><body><p begin='0s' end='1s'>&#x110000;</p></body></tt>`,
    `<tt><body><p begin='0s' end='1s'>& bare</p></body></tt>`,
    `<tt><body><p begin='00:99:01' end='99s'>X</p></body></tt>`,
    `<tt><body><p begin='wallclock(2020-01-01T00:00:00)' dur='1s'>X</p></body></tt>`,
    `<tt><body timeContainer='seq'><p dur='1s'>X</p></body></tt>`,
    `<tt><body><p begin='0s' end='2s'><span begin='1s'>X</span></p></body></tt>`,
    `<tt><body><p begin='0s'>No end</p></body></tt>`,
    `<tt><body><p begin='2s' end='1s'>Reverse</p></body></tt>`,
    `<tt><body><unknown>Lost</unknown></body></tt>`,
    `<tt><body>Lost text</body></tt>`,
    `<tt><body><x:p begin='0s' end='1s'>X</x:p></body></tt>`,
    `<tt><body><p begin='0s' begin='1s' end='2s'>X</p></body></tt>`,
    `<tt xmlns='urn:not-ttml'><body><p begin='0s' end='1s'>X</p></body></tt>`
  ];
  for (const text of cases) {
    assert.throws(() => subs.convertBuffer(Buffer.from(text), 'srt', { sourceFormat: 'ttml' }), (error) => /^SUBTITLE_(PARSE_ERROR|UNSUPPORTED_TTML)$/.test(error.code), text);
  }
});

test('TTML recognizes valid empty documents but never unknown text as empty subtitles', () => {
  assert.deepEqual(subs.parseTtml('<tt><body><div/></body></tt>'), []);
  assert.equal(subs.convertBuffer(Buffer.from('<tt><body/></tt>'), 'srt').cueCount, 0);
  for (const text of ['not subtitles', '1\n00:00:bad --> no\nLost', '<html><p>Lost</p></html>', '[Events]\nGibberish']) {
    assert.throws(() => subs.convertBuffer(Buffer.from(text), 'srt'), { code: 'SUBTITLE_PARSE_ERROR' });
  }
  assert.throws(() => subs.convertBuffer(Buffer.from(SRT), 'unknown'), { code: 'SUBTITLE_UNSUPPORTED_FORMAT' });
});

test('explicit sourceCharset correctly decodes Big5 and Shift-JIS', () => {
  for (const [charset, bytes, text] of [
    ['big5', 'a741a66e', '你好'],
    ['shift_jis', '82b182f182c982bf82cd', 'こんにちは']
  ]) {
    const decoded = subs.decodeBuffer(Buffer.from(bytes, 'hex'), { sourceCharset: charset });
    assert.deepEqual(decoded, { charset, text, confidence: 1, ambiguous: false });
    const input = Buffer.concat([Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n'), Buffer.from(bytes, 'hex')]);
    for (const result of [
      subs.convertBuffer(input, 'vtt', { sourceCharset: charset }),
      subs.shiftBuffer(input, 500, { sourceCharset: charset }),
      subs.reencodeBuffer(input, 'utf-8', { sourceCharset: charset })
    ]) {
      assert.equal(result.charset, charset);
      assert.equal(result.confidence, 1);
      assert.equal(result.ambiguous, false);
      assert.match(result.buffer.toString(), new RegExp(text));
    }
  }
});

test('auto legacy charset decoding is explicitly ambiguous and transforms require a source choice', () => {
  for (const bytes of ['c4e3bac3', 'a741a66e', '82b182f182c982bf82cd']) {
    const buf = Buffer.from(bytes, 'hex');
    const decoded = subs.decodeBuffer(buf);
    assert.equal(decoded.ambiguous, true);
    assert.ok(decoded.confidence < 0.5);
    for (const transform of [() => subs.convertBuffer(buf, 'srt'), () => subs.shiftBuffer(buf, 0), () => subs.reencodeBuffer(buf, 'utf-8')]) {
      assert.throws(transform, { code: 'SUBTITLE_CHARSET_AMBIGUOUS', ambiguous: true });
    }
  }
});

test('decoding rejects invalid selected encodings and malformed Unicode rather than replacing bytes', () => {
  assert.throws(() => subs.decodeBuffer(Buffer.from([0xff]), { sourceCharset: 'utf-8' }), { code: 'SUBTITLE_DECODE_ERROR' });
  assert.throws(() => subs.decodeBuffer(Buffer.from([0xff, 0xfe, 0x61])), { code: 'SUBTITLE_DECODE_ERROR' });
  assert.throws(() => subs.decodeBuffer(Buffer.from([0xfe, 0xff, 0x61])), { code: 'SUBTITLE_DECODE_ERROR' });
  assert.throws(() => subs.decodeBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0xff])), { code: 'SUBTITLE_DECODE_ERROR' });
  assert.throws(() => subs.decodeBuffer(Buffer.from('a'), { sourceCharset: 'made-up' }), { code: 'SUBTITLE_UNSUPPORTED_CHARSET' });
  assert.throws(() => subs.reencodeBuffer(Buffer.from(SRT), 'gbk'), { code: 'SUBTITLE_UNSUPPORTED_CHARSET' });
});

test('Unicode transforms return the same charset/confidence/ambiguous contract', () => {
  for (const result of [subs.decodeBuffer(Buffer.from(SRT)), subs.convertBuffer(Buffer.from(SRT), 'vtt'), subs.shiftBuffer(Buffer.from(SRT), 0), subs.reencodeBuffer(Buffer.from(SRT), 'utf-8bom')]) {
    assert.equal(result.charset, 'utf-8');
    assert.equal(result.confidence, 1);
    assert.equal(result.ambiguous, false);
  }
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
