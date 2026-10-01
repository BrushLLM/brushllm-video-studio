// Subtitle engine: parse / write SRT, VTT, ASS, SSA, TTML; timeline shift;
// charset detection & conversion. Pure JS, no dependencies.
//
// Internal cue: { start: ms, end: ms, text: string } — text uses '\n' for
// line breaks and carries simple markup (<i>, <b>) where the format allows.

// ------------------------------------------------------------------ time

function msToSrtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(milli).padStart(3, '0')}`;
}

function msToVttTime(ms) {
  return msToSrtTime(ms).replace(',', '.');
}

function msToAssTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${String(cs).padStart(2, '0')}`;
}

function msToTtmlTime(ms) {
  return msToVttTime(ms);
}

function parseTimeToMs(str) {
  if (str == null) return null;
  str = String(str).trim();
  let m;
  // HH:MM:SS,mmm / HH:MM:SS.mmm / H:MM:SS.cc
  if ((m = str.match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/))) {
    return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0');
  }
  // HH:MM:SS
  if ((m = str.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) {
    return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
  }
  // MM:SS.mmm (VTT allows omitting hours)
  if ((m = str.match(/^(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/))) {
    return (+m[1] * 60 + +m[2]) * 1000 + +m[3].padEnd(3, '0');
  }
  // offset-time: 12.5s / 500ms / 1300t (ticks)
  if ((m = str.match(/^([\d.]+)(ms|s|t|h|f)$/))) {
    const v = parseFloat(m[1]);
    if (m[2] === 'ms') return Math.round(v);
    if (m[2] === 's') return Math.round(v * 1000);
    if (m[2] === 'h') return Math.round(v * 3600000);
    if (m[2] === 't') return Math.round(v); // tickRate 1 unless given
    if (m[2] === 'f') return Math.round(v * (1000 / 30));
  }
  if (/^\d+$/.test(str)) return parseInt(str, 10); // bare ms
  return null;
}

// ------------------------------------------------------------- detection

function detectFormat(text) {
  const head = text.slice(0, 2000);
  if (/^\uFEFF?\s*WEBVTT/.test(head)) return 'vtt';
  if (/\[Script Info\]/i.test(head) || /\[V4\+? Styles\]/i.test(head) || /\[Events\]/i.test(head)) {
    return 'ass';
  }
  if (/^\s*<\?xml|<tt[\s>]/i.test(head)) return 'ttml';
  if (/\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/.test(head)) return 'srt';
  return 'srt';
}

const CHARSET_LABELS = {
  'utf-8': 'UTF-8',
  'utf-8bom': 'UTF-8 (BOM)',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  gbk: 'GBK',
  big5: 'Big5',
  'shift_jis': 'Shift-JIS',
  'euc-kr': 'EUC-KR',
  'iso-8859-1': 'Latin-1'
};

// Decode a subtitle buffer, auto-detecting the charset.
function decodeBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { charset: 'utf-8', text: buf.slice(3).toString('utf8') };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { charset: 'utf-16le', text: buf.slice(2).toString('utf16le') };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.slice(2));
    swapped.swap16();
    return { charset: 'utf-16be', text: swapped.toString('utf16le') };
  }
  // Strict UTF-8 check first.
  try {
    const strict = new TextDecoder('utf-8', { fatal: true });
    return { charset: 'utf-8', text: strict.decode(buf) };
  } catch {
    /* fall through to CJK guesses */
  }
  const candidates = ['gbk', 'big5', 'shift_jis', 'euc-kr'];
  let best = { charset: 'gbk', text: '', bad: Infinity };
  for (const cs of candidates) {
    try {
      const dec = new TextDecoder(cs, { fatal: false });
      const text = dec.decode(buf);
      const bad = (text.match(/\uFFFD/g) || []).length;
      // Also penalize unlikely control chars.
      if (bad < best.bad) best = { charset: cs, text, bad };
    } catch {
      /* decoder unavailable in this runtime */
    }
  }
  if (best.bad > 0 && best.bad > buf.length / 8) {
    return { charset: 'iso-8859-1', text: buf.toString('latin1') };
  }
  return { charset: best.charset, text: best.text };
}

function encodeText(text, charset) {
  switch (charset) {
    case 'utf-8bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    case 'utf-16be': {
      const le = Buffer.from(text, 'utf16le');
      le.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
    }
    default:
      return Buffer.from(text, 'utf8');
  }
}

// --------------------------------------------------------------- parsing

function parseSrt(text) {
  const cues = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let i = 0;
    if (!/-->/.test(lines[0]) && /^\d+$/.test(lines[0].trim())) i = 1; // index line
    const tcLine = lines[i];
    if (!tcLine || !/-->/.test(tcLine)) continue;
    const m = tcLine.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/
    );
    if (!m) continue;
    const start = parseTimeToMs(m[1]);
    const end = parseTimeToMs(m[2]);
    const body = lines.slice(i + 1).join('\n').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

function parseVtt(text) {
  const cues = [];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  // Skip header + STYLE/REGION/NOTE blocks.
  while (i < lines.length && !/^WEBVTT/.test(lines[i])) i++;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^(NOTE|STYLE|REGION)\b/.test(line.trim())) {
      i++;
      continue;
    }
    let tcLine = line;
    let j = i + 1;
    if (!/-->/.test(line)) {
      // cue id line; timecode on the next one
      if (lines[j] && /-->/.test(lines[j])) {
        tcLine = lines[j];
        j++;
      } else {
        i++;
        continue;
      }
    }
    const m = tcLine.match(
      /((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3})/
    );
    if (!m) {
      i++;
      continue;
    }
    const body = [];
    while (j < lines.length && lines[j].trim() !== '') {
      body.push(lines[j]);
      j++;
    }
    const start = parseTimeToMs(m[1]);
    const end = parseTimeToMs(m[2]);
    if (body.length) cues.push({ start, end, text: body.join('\n').trim() });
    i = j;
  }
  return cues;
}

function parseAss(text) {
  const cues = [];
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let fields = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^Format:/i.test(line) && /Start/i.test(line)) {
      fields = line.replace(/^Format:\s*/i, '').split(',').map((s) => s.trim());
      continue;
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const rest = line.replace(/^Dialogue:\s*/i, '');
    // Split on commas, but the Text field keeps its commas: split into
    // exactly fields.length parts.
    const parts = [];
    let cur = '';
    for (const ch of rest) {
      if (ch === ',' && parts.length < fields.length - 1) {
        parts.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    const get = (name) => parts[fields.indexOf(name)];
    const start = parseTimeToMs(get('Start'));
    const end = parseTimeToMs(get('End'));
    let body = (get('Text') || '').trim();
    body = body.replace(/\{[^}]*\}/g, ''); // strip override tags
    body = body.replace(/\\[Nn]/g, '\n');
    body = body.replace(/\\[Hh]/g, ' ');
    if (body) cues.push({ start, end, text: body.trim() });
  }
  return cues;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseTtml(text) {
  const cues = [];
  // Extract tickRate / frameRate if declared.
  const tickRate = parseFloat((text.match(/tickRate\s*=\s*"(\d+)"/) || [])[1]) || 1;
  const frameRate = parseFloat((text.match(/frameRate\s*=\s*"(\d+)"/) || [])[1]) || 30;
  const toMs = (str) => {
    if (str == null) return null;
    str = String(str).trim();
    let m;
    if ((m = str.match(/^([\d.]+)t$/))) return Math.round((parseFloat(m[1]) / tickRate) * 1000);
    if ((m = str.match(/^([\d.]+)f$/))) return Math.round((parseFloat(m[1]) * 1000) / frameRate);
    return parseTimeToMs(str);
  };
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p\s*>|<p\b([^>]*?)\/>/gi;
  let match;
  while ((match = pRe.exec(text))) {
    const attrs = match[1] || match[3] || '';
    const inner = match[2] || '';
    const begin = toMs((attrs.match(/begin\s*=\s*"([^"]*)"/) || [])[1]);
    let end = toMs((attrs.match(/end\s*=\s*"([^"]*)"/) || [])[1]);
    if (end == null) {
      const dur = toMs((attrs.match(/dur\s*=\s*"([^"]*)"/) || [])[1]);
      if (dur != null && begin != null) end = begin + dur;
    }
    if (begin == null || end == null) continue;
    let body = inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    body = decodeXmlEntities(body);
    if (body) cues.push({ start: begin, end, text: body });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

function parse(text, format) {
  const fmt = format || detectFormat(text);
  switch (fmt) {
    case 'vtt':
      return { format: 'vtt', cues: parseVtt(text) };
    case 'ass':
    case 'ssa':
      return { format: fmt, cues: parseAss(text) };
    case 'ttml':
      return { format: 'ttml', cues: parseTtml(text) };
    default:
      return { format: 'srt', cues: parseSrt(text) };
  }
}

// ---------------------------------------------------------------- writing

function writeSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\n${msToSrtTime(c.start)} --> ${msToSrtTime(c.end)}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}

function writeVtt(cues) {
  return (
    'WEBVTT\n\n' +
    cues
      .map((c) => `${msToVttTime(c.start)} --> ${msToVttTime(c.end)}\n${c.text}`)
      .join('\n\n') +
    '\n'
  );
}

const ASS_HEADER = `[Script Info]
; Generated by BrushLLM Video Studio
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 384
PlayResY: 288
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function writeAss(cues) {
  const body = cues
    .map(
      (c) =>
        `Dialogue: 0,${msToAssTime(c.start)},${msToAssTime(c.end)},Default,,0,0,0,,${c.text
          .replace(/\n/g, '\\N')
          .replace(/,/g, '')}`
    )
    .join('\n');
  return ASS_HEADER + body + '\n';
}

function encodeXmlEntities(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function writeTtml(cues, { lang = '' } = {}) {
  const ps = cues
    .map((c) => {
      const text = c.text
        .split('\n')
        .map((l) => encodeXmlEntities(l.trim()))
        .join('<br/>');
      return `    <p begin="${msToTtmlTime(c.start)}" end="${msToTtmlTime(c.end)}">${text}</p>`;
    })
    .join('\n');
  const langAttr = lang ? ` xml:lang="${lang}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"${langAttr}>
  <head>
    <metadata/>
  </head>
  <body>
    <div>
${ps}
    </div>
  </body>
</tt>
`;
}

function write(cues, format, opts = {}) {
  switch (format) {
    case 'vtt':
      return writeVtt(cues);
    case 'ass':
      return writeAss(cues);
    case 'ssa':
      return writeAss(cues).replace('v4.00+', 'v4.00').replace('[V4+ Styles]', '[V4 Styles]');
    case 'ttml':
      return writeTtml(cues, opts);
    default:
      return writeSrt(cues);
  }
}

// -------------------------------------------------------------- transforms

function shiftCues(cues, ms, { drop = false } = {}) {
  return cues
    .map((c) => ({ ...c, start: c.start + ms, end: c.end + ms }))
    .filter((c) => (drop ? c.end > 0 : true))
    .map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.max(0, c.end) }));
}

// ------------------------------------------------------------ file-level

const EXT_FORMATS = {
  '.srt': 'srt',
  '.vtt': 'vtt',
  '.ass': 'ass',
  '.ssa': 'ssa',
  '.ttml': 'ttml',
  '.xml': 'ttml',
  '.dfxp': 'ttml'
};

function extOfFormat(format) {
  return { srt: '.srt', vtt: '.vtt', ass: '.ass', ssa: '.ssa', ttml: '.ttml' }[format] || '.srt';
}

// Convert a subtitle buffer to a target format. Returns metadata + new buffer.
function convertBuffer(buf, targetFormat, { sourceFormat } = {}) {
  const { charset, text } = decodeBuffer(buf);
  const parsed = parse(text, sourceFormat);
  const outText = write(parsed.cues, targetFormat);
  return {
    buffer: Buffer.from(outText, 'utf8'),
    fromFormat: parsed.format,
    charset,
    cueCount: parsed.cues.length,
    targetFormat
  };
}

// Re-encode a subtitle file to a target charset (UTF-8 family).
function reencodeBuffer(buf, targetCharset) {
  const { charset, text } = decodeBuffer(buf);
  return { buffer: encodeText(text, targetCharset), fromCharset: charset };
}

function shiftBuffer(buf, ms, { drop = false, sourceFormat } = {}) {
  const { text } = decodeBuffer(buf);
  const parsed = parse(text, sourceFormat);
  const shifted = shiftCues(parsed.cues, ms, { drop });
  return { buffer: Buffer.from(write(shifted, parsed.format), 'utf8'), cueCount: shifted.length };
}

module.exports = {
  parse,
  write,
  parseSrt,
  parseVtt,
  parseAss,
  parseTtml,
  writeSrt,
  writeVtt,
  writeAss,
  writeTtml,
  detectFormat,
  decodeBuffer,
  encodeText,
  shiftCues,
  shiftBuffer,
  convertBuffer,
  reencodeBuffer,
  msToSrtTime,
  msToVttTime,
  msToAssTime,
  parseTimeToMs,
  CHARSET_LABELS,
  EXT_FORMATS,
  extOfFormat
};
