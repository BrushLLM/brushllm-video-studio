'use strict';

// Subtitle engine. The cue model is { start: ms, end: ms, text: string }.
// ASS/SSA shifting is deliberately handled as a source-preserving edit rather
// than by converting the document through this cue model.

function subtitleError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function parseError(message) {
  return subtitleError('SUBTITLE_PARSE_ERROR', message);
}

function unsupportedTtml(message) {
  return subtitleError('SUBTITLE_UNSUPPORTED_TTML', message);
}

function unsupportedFormat(format) {
  return subtitleError('SUBTITLE_UNSUPPORTED_FORMAT', `Unsupported subtitle format: ${format}`);
}

// ------------------------------------------------------------------ time

function msToSrtTime(ms) {
  ms = Math.max(0, Math.round(Number(ms) || 0));
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
  ms = Math.max(0, Math.round(Number(ms) || 0));
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

function parseClockParts(hours, minutes, seconds, fraction = '') {
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  if (![h, m, s].every(Number.isFinite) || m > 59 || s > 59) return null;
  const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0;
  return Math.round((h * 3600 + m * 60 + s) * 1000 + fractionMs);
}

function parseTimeToMs(value) {
  if (value == null) return null;
  const str = String(value).trim();
  let m;
  if ((m = str.match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/))) {
    return parseClockParts(m[1], m[2], m[3], m[4]);
  }
  if ((m = str.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) {
    return parseClockParts(m[1], m[2], m[3]);
  }
  if ((m = str.match(/^(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/))) {
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    if (seconds > 59) return null;
    return Math.round((minutes * 60 + seconds) * 1000 + Number(`0.${m[3]}`) * 1000);
  }
  if ((m = str.match(/^(\d+(?:\.\d+)?)(ms|s|h|f|t)$/))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    if (m[2] === 'ms') return Math.round(n);
    if (m[2] === 's') return Math.round(n * 1000);
    if (m[2] === 'h') return Math.round(n * 3600000);
    if (m[2] === 'f') return Math.round(n * (1000 / 30));
    return Math.round(n);
  }
  if (/^\d+$/.test(str)) return Number(str);
  return null;
}

// ------------------------------------------------------------- detection

function normalizeFormat(format) {
  if (typeof format !== 'string') return null;
  const value = format.trim().toLowerCase().replace(/^\./, '');
  if (value === 'srt' || value === 'subrip') return 'srt';
  if (value === 'vtt' || value === 'webvtt') return 'vtt';
  if (value === 'ass') return 'ass';
  if (value === 'ssa') return 'ssa';
  if (value === 'ttml' || value === 'dfxp' || value === 'xml') return 'ttml';
  return null;
}

function detectFormat(text) {
  const source = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  if (/^\s*WEBVTT\b/.test(source)) return 'vtt';
  if (/^\s*\[(?:Script Info|V4\+? Styles|Events)\]/im.test(source)) {
    return /^\s*ScriptType\s*:\s*v4\.00\s*$/im.test(source) || /^\s*\[V4 Styles\]/im.test(source)
      ? 'ssa'
      : 'ass';
  }
  if (/^\s*</.test(source)) return 'ttml';
  if (/\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/.test(source)) return 'srt';
  return null;
}

// -------------------------------------------------------------- charsets

const CHARSET_LABELS = {
  'utf-8': 'UTF-8',
  'utf-8bom': 'UTF-8 (BOM)',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  gbk: 'GBK',
  big5: 'Big5',
  shift_jis: 'Shift-JIS',
  'euc-kr': 'EUC-KR',
  'iso-8859-1': 'Latin-1'
};

function normalizeCharset(charset) {
  if (typeof charset !== 'string') {
    throw subtitleError('SUBTITLE_UNSUPPORTED_CHARSET', 'Source charset must be a string.');
  }
  const key = charset.trim().toLowerCase().replace(/[\s_]+/g, '-');
  const aliases = {
    utf8: 'utf-8',
    'utf-8-bom': 'utf-8bom',
    'utf8-bom': 'utf-8bom',
    utf8bom: 'utf-8bom',
    utf16le: 'utf-16le',
    'utf-16-le': 'utf-16le',
    utf16be: 'utf-16be',
    'utf-16-be': 'utf-16be',
    'shift-jis': 'shift_jis',
    sjis: 'shift_jis',
    latin1: 'iso-8859-1',
    'iso8859-1': 'iso-8859-1'
  };
  const normalized = aliases[key] || key;
  if (!Object.hasOwn(CHARSET_LABELS, normalized)) {
    throw subtitleError('SUBTITLE_UNSUPPORTED_CHARSET', `Unsupported source charset: ${charset}`);
  }
  return normalized;
}

function strictDecode(buf, charset) {
  try {
    if (charset === 'iso-8859-1') return buf.toString('latin1');
    if ((charset === 'utf-16le' || charset === 'utf-16be') && buf.length % 2 !== 0) {
      throw new Error('odd UTF-16 byte count');
    }
    const decoder = new TextDecoder(charset, { fatal: true, ignoreBOM: false });
    return decoder.decode(buf);
  } catch {
    throw subtitleError('SUBTITLE_DECODE_ERROR', `Invalid ${charset} subtitle bytes; check the selected source charset.`);
  }
}

function hasUtf8Bom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

function decodeBuffer(buf, { sourceCharset } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (sourceCharset != null && sourceCharset !== '' && sourceCharset !== 'auto') {
    const requested = normalizeCharset(sourceCharset);
    const charset = requested === 'utf-8bom' ? 'utf-8' : requested;
    return { charset, text: strictDecode(buf, charset), confidence: 1, ambiguous: false };
  }

  let charset = null;
  if (hasUtf8Bom(buf)) charset = 'utf-8';
  else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) charset = 'utf-16le';
  else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) charset = 'utf-16be';
  if (charset) return { charset, text: strictDecode(buf, charset), confidence: 1, ambiguous: false };

  try {
    const text = strictDecode(buf, 'utf-8');
    const ambiguous = text.includes('\0');
    return { charset: 'utf-8', text, confidence: ambiguous ? 0 : 1, ambiguous };
  } catch {
    // Legacy decoders below are previews. They are never treated as an
    // authoritative choice without an explicit sourceCharset option.
  }

  let best = { charset: 'iso-8859-1', text: buf.toString('latin1'), bad: Infinity };
  for (const candidate of ['gbk', 'big5', 'shift_jis', 'euc-kr']) {
    try {
      const text = new TextDecoder(candidate, { fatal: false }).decode(buf);
      const bad = (text.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
      if (bad < best.bad) best = { charset: candidate, text, bad };
    } catch {
      // Some platform ICU builds do not expose every legacy decoder.
    }
  }
  if (best.bad > buf.length / 8) {
    best = { charset: 'iso-8859-1', text: buf.toString('latin1'), bad: 1 };
  }
  return {
    charset: best.charset,
    text: best.text,
    confidence: best.bad === 0 ? 0.25 : 0,
    ambiguous: true
  };
}

function requireUnambiguous(decoded) {
  if (decoded.ambiguous) {
    throw subtitleError(
      'SUBTITLE_CHARSET_AMBIGUOUS',
      'Subtitle source charset is uncertain; select sourceCharset explicitly before converting or editing.',
      { charset: decoded.charset, confidence: decoded.confidence, ambiguous: true }
    );
  }
  return decoded;
}

function charsetMetadata(decoded) {
  return {
    charset: decoded.charset,
    confidence: decoded.confidence,
    ambiguous: decoded.ambiguous
  };
}

function encodeText(text, charset) {
  const normalized = normalizeCharset(charset);
  switch (normalized) {
    case 'utf-8bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
    case 'utf-16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    case 'utf-16be': {
      const le = Buffer.from(text, 'utf16le');
      le.swap16();
      return Buffer.concat([Buffer.from([0xfe, 0xff]), le]);
    }
    case 'utf-8':
      return Buffer.from(text, 'utf8');
    default:
      throw subtitleError('SUBTITLE_UNSUPPORTED_CHARSET', `Unsupported output charset: ${charset}`);
  }
}

// --------------------------------------------------------------- parsing

function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

function parseSrt(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  if (!source.trim()) return [];
  const cues = [];
  const blocks = normalizeNewlines(source).split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    while (lines.length && lines[0].trim() === '') lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    if (!lines.length) continue;
    let timeIndex = 0;
    if (/^\d+$/.test(lines[0].trim())) timeIndex = 1;
    const timing = lines[timeIndex] || '';
    const m = timing.match(/(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})/);
    if (!m) throw parseError('Invalid SRT cue timing.');
    const start = parseTimeToMs(m[1]);
    const end = parseTimeToMs(m[2]);
    if (start == null || end == null || end < start) throw parseError('Invalid SRT cue time range.');
    const body = lines.slice(timeIndex + 1).join('\n').trim();
    if (!body) throw parseError('SRT cue has no text.');
    cues.push({ start, end, text: body });
  }
  if (!cues.length) throw parseError('Subtitle content contains no valid SRT cues.');
  return cues;
}

function parseVtt(text) {
  const source = normalizeNewlines(String(text).replace(/^\uFEFF/, ''));
  const lines = source.split('\n');
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first++;
  if (first >= lines.length || !/^WEBVTT\b/.test(lines[first])) throw parseError('Invalid WEBVTT header.');
  const blocks = source.split(/\n{2,}/).slice(1);
  const cues = [];
  for (const block of blocks) {
    const rows = block.split('\n');
    if (!rows.some((row) => row.trim() !== '')) continue;
    const marker = rows[0].trim();
    if (/^(NOTE|STYLE|REGION)\b/.test(marker)) continue;
    let timingIndex = rows.findIndex((row) => row.includes('-->'));
    if (timingIndex < 0) throw parseError('Invalid WEBVTT cue timing.');
    const timing = rows[timingIndex];
    const m = timing.match(/((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})/);
    if (!m) throw parseError('Invalid WEBVTT cue timing.');
    const start = parseTimeToMs(m[1]);
    const end = parseTimeToMs(m[2]);
    if (start == null || end == null || end < start) throw parseError('Invalid WEBVTT cue time range.');
    const body = rows.slice(timingIndex + 1).join('\n').trim();
    if (!body) throw parseError('WEBVTT cue has no text.');
    cues.push({ start, end, text: body });
  }
  return cues;
}

const DEFAULT_ASS_FIELDS = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
const DEFAULT_SSA_FIELDS = ['Marked', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];

function fieldNames(fields) {
  return fields.map((field) => String(field).trim().toLowerCase());
}

function assFormatFields(line) {
  const raw = line.replace(/^\s*Format\s*:\s*/i, '');
  const fields = raw.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (!fields.length) throw parseError('ASS/SSA Events Format is empty.');
  const names = fieldNames(fields);
  for (const name of ['start', 'end', 'text']) {
    if (names.indexOf(name) < 0) throw parseError(`ASS/SSA Events Format is missing ${name}.`);
  }
  if (names.filter((name) => name === 'start').length !== 1 || names.filter((name) => name === 'end').length !== 1 || names.filter((name) => name === 'text').length !== 1) {
    throw parseError('ASS/SSA Events Format contains duplicate timing or text fields.');
  }
  return fields;
}

function splitAssFields(rest, count) {
  if (!Number.isInteger(count) || count < 1) throw parseError('Invalid ASS/SSA field layout.');
  const parts = [];
  let start = 0;
  for (let i = 0; i < count - 1; i++) {
    const comma = rest.indexOf(',', start);
    if (comma < 0) throw parseError('ASS/SSA Dialogue line has too few fields.');
    parts.push(rest.slice(start, comma));
    start = comma + 1;
  }
  parts.push(rest.slice(start));
  return parts;
}

function assDialogueParts(line, fields) {
  const match = line.match(/^\s*(Dialogue|Comment)\s*:\s?(.*)$/i);
  if (!match) throw parseError('Invalid ASS/SSA event line.');
  const parts = splitAssFields(match[2], fields.length);
  const names = fieldNames(fields);
  const startIndex = names.indexOf('start');
  const endIndex = names.indexOf('end');
  const textIndex = names.indexOf('text');
  if (startIndex < 0 || endIndex < 0 || textIndex < 0 || startIndex === endIndex) {
    throw parseError('ASS/SSA Format line must declare distinct Start, End and Text fields.');
  }
  // The Text field is the final field and keeps its commas; a line whose last
  // declared field is not Text has its content split incorrectly.
  if (textIndex !== fields.length - 1) {
    throw parseError('ASS/SSA Format line must declare Text as the final field.');
  }
  const start = parseTimeToMs(parts[startIndex]);
  const end = parseTimeToMs(parts[endIndex]);
  if (start == null || end == null || end < start) throw parseError('Invalid ASS/SSA Dialogue timing.');
  return { parts, startIndex, endIndex, textIndex, start, end, prefix: match[1] };
}

function splitLinesPreserve(text) {
  const result = [];
  let start = 0;
  const re = /\r\n|\r|\n/g;
  let match;
  while ((match = re.exec(text))) {
    result.push({ line: text.slice(start, match.index), sep: match[0] });
    start = match.index + match[0].length;
  }
  result.push({ line: text.slice(start), sep: '' });
  return result;
}

function assDocumentInfo(text) {
  const lines = splitLinesPreserve(String(text).replace(/^\uFEFF/, ''));
  let section = '';
  let fields = null;
  let scriptType = 'ass';
  let hasEvents = false;
  let dialogueCount = 0;
  for (const entry of lines) {
    const trimmed = entry.line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      if (section === 'events') {
        hasEvents = true;
        fields = null;
      }
      continue;
    }
    if (/^ScriptType\s*:\s*v4\.00\s*$/i.test(trimmed)) scriptType = 'ssa';
    if (section !== 'events') continue;
    if (/^Format\s*:/i.test(trimmed)) {
      fields = assFormatFields(trimmed);
      continue;
    }
    if (/^Dialogue\s*:/i.test(trimmed)) {
      dialogueCount++;
      const active = fields || (scriptType === 'ssa' ? DEFAULT_SSA_FIELDS : DEFAULT_ASS_FIELDS);
      assDialogueParts(entry.line, active);
      continue;
    }
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('!')) continue;
    if (/^(Comment|Picture|Sound|Movie|Command)\s*:/i.test(trimmed)) continue;
    throw parseError(`Unsupported or malformed ASS/SSA Events line: ${trimmed.slice(0, 80)}`);
  }
  if (!hasEvents && /\[Script Info\]|\[V4\+? Styles\]/i.test(String(text))) {
    throw parseError('ASS/SSA document has no Events section.');
  }
  if (hasEvents && !fields && dialogueCount === 0 && !/\b(?:Comment|Picture|Sound|Movie|Command)\s*:/i.test(String(text))) {
    // A valid empty Events section may still have a Format line. Without it,
    // a header-looking input is almost certainly malformed subtitle text.
    if (/\[Events\]/i.test(String(text))) throw parseError('ASS/SSA Events section has no Format or events.');
  }
  return { lines, fields, scriptType, hasEvents, dialogueCount };
}

function stripAssOverrideTags(value) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\') {
      out += value[i];
      if (i + 1 < value.length) out += value[++i];
      continue;
    }
    if (value[i] !== '{') {
      out += value[i];
      continue;
    }
    let end = i + 1;
    while (end < value.length) {
      if (value[end] === '}' && value[end - 1] !== '\\') break;
      end++;
    }
    if (end >= value.length) {
      out += value[i];
    } else {
      i = end;
    }
  }
  return out;
}

function decodeAssText(value) {
  const source = stripAssOverrideTags(String(value));
  let out = '';
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') {
      out += source[i];
      continue;
    }
    const next = source[i + 1];
    if (next == null) {
      out += '\\';
    } else if (next === 'N' || next === 'n') {
      out += '\n';
      i++;
    } else if (next === 'H' || next === 'h') {
      out += ' ';
      i++;
    } else if (next === '\\') {
      out += '\\';
      i++;
    } else if (next === '{' || next === '}') {
      out += next;
      i++;
    } else {
      out += '\\' + next;
      i++;
    }
  }
  return out;
}

function parseAss(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const info = assDocumentInfo(source);
  const cues = [];
  let section = '';
  let fields = null;
  for (const entry of info.lines) {
    const trimmed = entry.line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      if (section === 'events') fields = null;
      continue;
    }
    if (section !== 'events') continue;
    if (/^Format\s*:/i.test(trimmed)) {
      fields = assFormatFields(trimmed);
      continue;
    }
    if (!/^Dialogue\s*:/i.test(trimmed)) continue;
    const active = fields || (info.scriptType === 'ssa' ? DEFAULT_SSA_FIELDS : DEFAULT_ASS_FIELDS);
    const parsed = assDialogueParts(entry.line, active);
    const textValue = decodeAssText(parsed.parts[parsed.textIndex]).trim();
    cues.push({ start: parsed.start, end: parsed.end, text: textValue });
  }
  if (!cues.length && !source.trim()) return [];
  return cues;
}

// --------------------------------------------------------------- TTML XML

const TTML_NS = 'http://www.w3.org/ns/ttml';
const TTML_PARAMETER_NS = 'http://www.w3.org/ns/ttml#parameter';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function decodeXmlEntities(value) {
  const source = String(value);
  let out = '';
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '&') {
      out += source[i];
      continue;
    }
    const end = source.indexOf(';', i + 1);
    if (end < 0) throw parseError('Unterminated XML entity.');
    const entity = source.slice(i + 1, end);
    if (entity === 'amp') out += '&';
    else if (entity === 'lt') out += '<';
    else if (entity === 'gt') out += '>';
    else if (entity === 'quot') out += '"';
    else if (entity === 'apos') out += "'";
    else if (/^#x[0-9a-f]+$/i.test(entity) || /^#\d+$/.test(entity)) {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw parseError('Invalid XML character reference.');
      }
      out += String.fromCodePoint(code);
    } else {
      throw parseError(`Unsupported XML entity: &${entity};`);
    }
    i = end;
  }
  return out;
}

function findXmlTagEnd(text, start) {
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function parseXmlStartBody(body) {
  let source = body.trim();
  let selfClosing = false;
  if (/\/\s*$/.test(source)) {
    selfClosing = true;
    source = source.replace(/\/\s*$/, '').trim();
  }
  const nameMatch = source.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
  if (!nameMatch) throw parseError('Invalid XML element name.');
  const qname = nameMatch[1];
  let pos = nameMatch[0].length;
  const attrs = [];
  const seen = new Set();
  while (pos < source.length) {
    while (/\s/.test(source[pos] || '')) pos++;
    if (pos >= source.length) break;
    const match = source.slice(pos).match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
    if (!match) throw parseError('Invalid XML attribute.');
    const attrName = match[1];
    pos += attrName.length;
    while (/\s/.test(source[pos] || '')) pos++;
    if (source[pos] !== '=') throw parseError(`XML attribute ${attrName} has no value.`);
    pos++;
    while (/\s/.test(source[pos] || '')) pos++;
    const quote = source[pos];
    if (quote !== '"' && quote !== "'") throw parseError('XML attributes must use single or double quotes.');
    pos++;
    const end = source.indexOf(quote, pos);
    if (end < 0) throw parseError(`Unterminated XML attribute ${attrName}.`);
    if (seen.has(attrName)) throw parseError(`Duplicate XML attribute ${attrName}.`);
    seen.add(attrName);
    attrs.push({ qname: attrName, value: decodeXmlEntities(source.slice(pos, end)) });
    pos = end + 1;
  }
  return { qname, attrs, selfClosing };
}

function splitQName(qname) {
  const index = qname.indexOf(':');
  return index < 0 ? { prefix: '', local: qname } : { prefix: qname.slice(0, index), local: qname.slice(index + 1) };
}

function parseXmlSubset(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  if (/<!DOCTYPE\b/i.test(source) || /<!ENTITY\b/i.test(source)) {
    throw unsupportedTtml('DOCTYPE and external XML entities are not supported.');
  }
  const roots = [];
  const stack = [];
  let pos = 0;
  const predefined = { xml: XML_NS };

  const append = (node) => {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
  };

  while (pos < source.length) {
    if (source[pos] !== '<') {
      const end = source.indexOf('<', pos);
      const stop = end < 0 ? source.length : end;
      const value = decodeXmlEntities(source.slice(pos, stop));
      if (stack.length) stack[stack.length - 1].children.push({ type: 'text', value });
      else if (value.trim()) throw parseError('Text exists outside the XML root.');
      pos = stop;
      continue;
    }
    if (source.startsWith('<!--', pos)) {
      const end = source.indexOf('-->', pos + 4);
      if (end < 0) throw parseError('Unterminated XML comment.');
      pos = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', pos)) {
      const end = source.indexOf(']]>', pos + 9);
      if (end < 0) throw parseError('Unterminated XML CDATA section.');
      if (!stack.length) throw parseError('CDATA exists outside the XML root.');
      stack[stack.length - 1].children.push({ type: 'text', value: source.slice(pos + 9, end) });
      pos = end + 3;
      continue;
    }
    if (source.startsWith('<?', pos)) {
      const end = source.indexOf('?>', pos + 2);
      if (end < 0) throw parseError('Unterminated XML processing instruction.');
      pos = end + 2;
      continue;
    }
    if (source.startsWith('</', pos)) {
      const end = source.indexOf('>', pos + 2);
      if (end < 0) throw parseError('Unterminated XML closing tag.');
      const name = source.slice(pos + 2, end).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) || !stack.length) throw parseError('Invalid XML closing tag.');
      const node = stack.pop();
      if (node.qname !== name) throw parseError(`Mismatched XML closing tag: ${name}.`);
      pos = end + 1;
      continue;
    }
    if (source.startsWith('<!', pos)) throw parseError('Unsupported XML declaration.');

    const end = findXmlTagEnd(source, pos + 1);
    if (end < 0) throw parseError('Unterminated XML start tag.');
    const parsed = parseXmlStartBody(source.slice(pos + 1, end));
    const parentNs = stack.length ? stack[stack.length - 1].nsMap : predefined;
    const nsMap = Object.assign({}, parentNs);
    for (const attr of parsed.attrs) {
      if (attr.qname === 'xmlns') nsMap[''] = attr.value;
      else if (attr.qname.startsWith('xmlns:')) nsMap[attr.qname.slice(6)] = attr.value;
    }
    const q = splitQName(parsed.qname);
    if (q.prefix && !Object.hasOwn(nsMap, q.prefix)) throw parseError(`Unbound XML namespace prefix: ${q.prefix}.`);
    const node = {
      type: 'element',
      qname: parsed.qname,
      prefix: q.prefix,
      local: q.local,
      ns: nsMap[q.prefix] || null,
      nsMap,
      attrs: parsed.attrs.map((attr) => {
        const aq = splitQName(attr.qname);
        const ans = attr.qname === 'xmlns' || aq.prefix === 'xmlns'
          ? 'http://www.w3.org/2000/xmlns/'
          : (aq.prefix ? (nsMap[aq.prefix] || null) : null);
        return { ...attr, prefix: aq.prefix, local: aq.local, ns: ans };
      }),
      children: []
    };
    append(node);
    if (!parsed.selfClosing) stack.push(node);
    pos = end + 1;
  }
  if (stack.length) throw parseError(`Unclosed XML element: ${stack[stack.length - 1].qname}.`);
  if (roots.length !== 1 || roots[0].type !== 'element') throw parseError('TTML must contain one XML root element.');
  return roots[0];
}

function elementIsTtml(node) {
  return node.ns == null || node.ns === TTML_NS;
}

function getAttr(node, local, acceptedNamespaces = [null, TTML_PARAMETER_NS, XML_NS]) {
  const matches = node.attrs.filter((attr) => attr.local.toLowerCase() === local.toLowerCase() && acceptedNamespaces.includes(attr.ns));
  if (matches.length > 1) throw parseError(`Duplicate TTML attribute ${local}.`);
  return matches.length ? matches[0].value : null;
}

function getTimingAttribute(node, local) {
  return getAttr(node, local, [null, TTML_NS, TTML_PARAMETER_NS]);
}

function parsePositiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw unsupportedTtml(`Invalid TTML ${label}.`);
  return n;
}

function ttmlTimingParameters(root) {
  const frameRateValue = getAttr(root, 'frameRate');
  const frameRate = frameRateValue == null ? 30 : parsePositiveNumber(frameRateValue, 'frameRate');
  const multiplierValue = getAttr(root, 'frameRateMultiplier');
  let multiplier = 1;
  if (multiplierValue != null) {
    const parts = multiplierValue.trim().split(/\s+/);
    if (parts.length !== 2) throw unsupportedTtml('TTML frameRateMultiplier must contain two numbers.');
    const numerator = parsePositiveNumber(parts[0], 'frameRateMultiplier');
    const denominator = parsePositiveNumber(parts[1], 'frameRateMultiplier');
    multiplier = numerator / denominator;
  }
  const subFrameRateValue = getAttr(root, 'subFrameRate');
  const subFrameRate = subFrameRateValue == null ? 1 : parsePositiveNumber(subFrameRateValue, 'subFrameRate');
  const tickRateValue = getAttr(root, 'tickRate');
  const tickRate = tickRateValue == null ? 1 : parsePositiveNumber(tickRateValue, 'tickRate');
  return { frameRate: frameRate * multiplier, subFrameRate, tickRate };
}

function parseTtmlTime(value, timing) {
  if (value == null || String(value).trim() === '') return null;
  const str = String(value).trim();
  let m;
  if ((m = str.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/))) {
    const base = parseClockParts(m[1], m[2], m[3], m[4] || '');
    if (base == null) throw parseError(`Invalid TTML clock time: ${str}.`);
    return base;
  }
  if ((m = str.match(/^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$/))) {
    const hours = Number(m[1]);
    const minutes = Number(m[2]);
    const seconds = Number(m[3]);
    const frames = Number(m[4]);
    const subframes = m[5] ? Number(m[5]) : 0;
    if (![hours, minutes, seconds, frames, subframes].every(Number.isFinite) || minutes > 59 || seconds > 59 || frames >= timing.frameRate || subframes >= timing.subFrameRate) {
      throw parseError(`Invalid TTML frame clock: ${str}.`);
    }
    return Math.round((hours * 3600 + minutes * 60 + seconds + (frames + subframes / timing.subFrameRate) / timing.frameRate) * 1000);
  }
  if ((m = str.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) throw parseError(`Invalid TTML offset time: ${str}.`);
    switch (m[2]) {
      case 'h': return Math.round(n * 3600000);
      case 'm': return Math.round(n * 60000);
      case 's': return Math.round(n * 1000);
      case 'ms': return Math.round(n);
      case 'f': return Math.round((n * 1000) / timing.frameRate);
      case 't': return Math.round((n * 1000) / timing.tickRate);
      default: break;
    }
  }
  throw unsupportedTtml(`Unsupported TTML time expression: ${str}.`);
}

function nodeTiming(node, parentInterval, timing) {
  const timeContainer = getTimingAttribute(node, 'timeContainer');
  if (timeContainer && timeContainer.toLowerCase() !== 'par') {
    throw unsupportedTtml(`TTML timeContainer=${timeContainer} is not supported.`);
  }
  const beginValue = getTimingAttribute(node, 'begin');
  const endValue = getTimingAttribute(node, 'end');
  const durValue = getTimingAttribute(node, 'dur');
  const begin = beginValue == null ? 0 : parseTtmlTime(beginValue, timing);
  const endOffset = endValue == null ? null : parseTtmlTime(endValue, timing);
  const dur = durValue == null ? null : parseTtmlTime(durValue, timing);
  if (begin == null || (endValue != null && endOffset == null) || (durValue != null && dur == null)) {
    throw parseError('Invalid TTML timing attributes.');
  }
  const start = parentInterval.start + begin;
  let end = endOffset == null ? null : parentInterval.start + endOffset;
  if (dur != null) end = start + dur;
  if (end == null) end = parentInterval.end;
  if (end < start) throw parseError('TTML timing interval ends before it starts.');
  if (start > parentInterval.end || end < parentInterval.start) throw parseError('TTML timing interval is outside its parent.');
  return { start, end: Math.min(end, parentInterval.end) };
}

function renderTtmlText(node, inheritedPreserve = false) {
  const xmlSpace = getAttr(node, 'space', [XML_NS]);
  const preserve = xmlSpace === 'preserve' ? true : xmlSpace === 'default' ? false : inheritedPreserve;
  let output = '';
  for (const child of node.children) {
    if (child.type === 'text') {
      output += child.value;
      continue;
    }
    if (child.local === 'br') {
      if (!elementIsTtml(child)) throw unsupportedTtml('Namespaced br is not TTML.');
      output += '\n';
      continue;
    }
    if (child.local === 'span') {
      if (!elementIsTtml(child)) throw unsupportedTtml('Namespaced span is not TTML.');
      if (getTimingAttribute(child, 'begin') != null || getTimingAttribute(child, 'end') != null || getTimingAttribute(child, 'dur') != null) {
        throw unsupportedTtml('Timed nested TTML spans are not supported.');
      }
      output += renderTtmlText(child, preserve);
      continue;
    }
    throw unsupportedTtml(`TTML element ${child.qname} is not supported inside p.`);
  }
  return preserve ? output : output.trim();
}

function validateHead(node) {
  if (!elementIsTtml(node)) throw unsupportedTtml(`TTML element ${node.qname} is in an unsupported namespace.`);
  for (const child of node.children) {
    if (child.type === 'text') {
      if (child.value.trim()) throw parseError('Text is not allowed directly in TTML head.');
    } else {
      validateHead(child);
    }
  }
}

function parseTtml(text) {
  const root = parseXmlSubset(text);
  if (root.local !== 'tt' || !elementIsTtml(root)) {
    // An XML document that is not TTML is simply not a subtitle we understand.
    throw parseError('Only a TTML tt root is supported.');
  }
  const timing = ttmlTimingParameters(root);
  const rootInterval = nodeTiming(root, { start: 0, end: Infinity }, timing);
  const cues = [];
  let cueOrder = 0;

  const visitContainer = (node, parentInterval, kind) => {
    if (!elementIsTtml(node)) throw unsupportedTtml(`TTML element ${node.qname} is in an unsupported namespace.`);
    const interval = nodeTiming(node, parentInterval, timing);
    for (const child of node.children) {
      if (child.type === 'text') {
        if (child.value.trim()) throw parseError(`Text is not allowed directly inside TTML ${kind}.`);
        continue;
      }
      if (!elementIsTtml(child)) throw unsupportedTtml(`TTML element ${child.qname} is in an unsupported namespace.`);
      if (child.local === 'p') {
        const pInterval = nodeTiming(child, interval, timing);
        const body = renderTtmlText(child, getAttr(child, 'space', [XML_NS]) === 'preserve');
        if (!body) continue;
        if (pInterval.end === Infinity) throw unsupportedTtml('TTML cues must have a finite end time.');
        if (pInterval.end <= pInterval.start) throw parseError('TTML cue has an empty time interval.');
        cues.push({ start: pInterval.start, end: pInterval.end, text: body, _order: cueOrder++ });
      } else if (child.local === 'div') {
        visitContainer(child, interval, 'div');
      } else {
        throw unsupportedTtml(`TTML element ${child.qname} is not supported in ${kind}.`);
      }
    }
  };

  for (const child of root.children) {
    if (child.type === 'text') {
      if (child.value.trim()) throw parseError('Text is not allowed directly inside TTML tt.');
      continue;
    }
    if (!elementIsTtml(child)) throw unsupportedTtml(`TTML element ${child.qname} is in an unsupported namespace.`);
    if (child.local === 'head') validateHead(child);
    else if (child.local === 'body') visitContainer(child, rootInterval, 'body');
    else throw unsupportedTtml(`TTML element ${child.qname} is not supported under tt.`);
  }

  cues.sort((a, b) => a.start - b.start || a._order - b._order);
  return cues.map(({ start, end, text: cueText }) => ({ start, end, text: cueText }));
}

function parse(text, format) {
  const requested = format == null ? null : normalizeFormat(format);
  if (format != null && !requested) throw unsupportedFormat(format);
  const fmt = requested || detectFormat(text);
  if (!fmt) throw parseError('Subtitle content is not a recognized subtitle format.');
  switch (fmt) {
    case 'vtt': return { format: 'vtt', cues: parseVtt(text) };
    case 'ass': return { format: 'ass', cues: parseAss(text) };
    case 'ssa': return { format: 'ssa', cues: parseAss(text) };
    case 'ttml': return { format: 'ttml', cues: parseTtml(text) };
    case 'srt': return { format: 'srt', cues: parseSrt(text) };
    default: throw unsupportedFormat(fmt);
  }
}

// ---------------------------------------------------------------- writing

function writeSrt(cues) {
  return `${cues.map((cue, i) => `${i + 1}\n${msToSrtTime(cue.start)} --> ${msToSrtTime(cue.end)}\n${cue.text}`).join('\n\n')}\n`;
}

function writeVtt(cues) {
  return `WEBVTT\n\n${cues.map((cue) => `${msToVttTime(cue.start)} --> ${msToVttTime(cue.end)}\n${cue.text}`).join('\n\n')}\n`;
}

const ASS_HEADER = `[Script Info]\n; Generated by BrushLLM Video Studio\nScriptType: v4.00+\nWrapStyle: 0\nPlayResX: 384\nPlayResY: 288\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

const SSA_HEADER = `[Script Info]\n; Generated by BrushLLM Video Studio\nScriptType: v4.00\nWrapStyle: 0\nPlayResX: 384\nPlayResY: 288\n\n[V4 Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,0,0,1,2,0,2,10,10,10,0,1\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

function decodeBasicEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeAssPlain(value) {
  return decodeBasicEntities(value).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

function writeAssText(value) {
  const lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line) => {
    let out = '';
    let pos = 0;
    const re = /<\/?(i|b|u|s)\s*>/gi;
    let match;
    while ((match = re.exec(line))) {
      out += escapeAssPlain(line.slice(pos, match.index));
      const closing = match[0][1] === '/';
      const tag = match[1].toLowerCase();
      const code = tag === 'i' ? 'i' : tag === 'b' ? 'b' : tag === 'u' ? 'u' : 's';
      out += `{\\${code}${closing ? 0 : 1}}`;
      pos = match.index + match[0].length;
    }
    out += escapeAssPlain(line.slice(pos));
    return out;
  }).join('\\N');
}

function writeAss(cues) {
  const body = cues.map((cue) => `Dialogue: 0,${msToAssTime(cue.start)},${msToAssTime(cue.end)},Default,,0,0,0,,${writeAssText(cue.text)}`).join('\n');
  return ASS_HEADER + body + '\n';
}

function writeSsa(cues) {
  const body = cues.map((cue) => `Dialogue: Marked=0,${msToAssTime(cue.start)},${msToAssTime(cue.end)},Default,,0,0,0,,${writeAssText(cue.text)}`).join('\n');
  return SSA_HEADER + body + '\n';
}

function encodeXmlEntities(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function writeTtml(cues, { lang = '' } = {}) {
  const ps = cues.map((cue) => {
    const text = String(cue.text).split(/\r\n?|\n/).map((line) => encodeXmlEntities(line)).join('<br/>');
    return `    <p begin="${msToTtmlTime(cue.start)}" end="${msToTtmlTime(cue.end)}">${text}</p>`;
  }).join('\n');
  const langAttr = lang ? ` xml:lang="${encodeXmlEntities(lang)}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>\n<tt xmlns="${TTML_NS}"${langAttr}>\n  <head>\n    <metadata/>\n  </head>\n  <body>\n    <div>\n${ps}\n    </div>\n  </body>\n</tt>\n`;
}

function write(cues, format, opts = {}) {
  const fmt = normalizeFormat(format);
  if (!fmt) throw unsupportedFormat(format);
  switch (fmt) {
    case 'vtt': return writeVtt(cues);
    case 'ass': return writeAss(cues);
    case 'ssa': return writeSsa(cues);
    case 'ttml': return writeTtml(cues, opts);
    case 'srt': return writeSrt(cues);
    default: throw unsupportedFormat(format);
  }
}

// -------------------------------------------------------------- transforms

function shiftCues(cues, ms, { drop = false } = {}) {
  return cues
    .map((cue) => ({ ...cue, start: cue.start + ms, end: cue.end + ms }))
    .filter((cue) => (drop ? cue.end > 0 : true))
    .map((cue) => ({ ...cue, start: Math.max(0, cue.start), end: Math.max(0, cue.end) }));
}

function replaceTimeField(value, shiftedMs) {
  const source = String(value);
  const leading = (source.match(/^\s*/) || [''])[0];
  const trailing = (source.match(/\s*$/) || [''])[0];
  const end = trailing.length ? source.length - trailing.length : source.length;
  return `${leading}${msToAssTime(shiftedMs)}${source.slice(end)}`;
}

function shiftAssText(text, ms, { drop = false } = {}) {
  const source = String(text).replace(/^\uFEFF/, '');
  const info = assDocumentInfo(source);
  const result = [];
  let section = '';
  let fields = null;
  let cueCount = 0;
  for (const entry of info.lines) {
    const trimmed = entry.line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      if (section === 'events') fields = null;
      result.push(entry);
      continue;
    }
    if (section === 'events' && /^Format\s*:/i.test(trimmed)) {
      fields = assFormatFields(trimmed);
      result.push(entry);
      continue;
    }
    if (section !== 'events' || !/^\s*(Dialogue|Comment)\s*:/i.test(entry.line)) {
      result.push(entry);
      continue;
    }
    const active = fields || (info.scriptType === 'ssa' ? DEFAULT_SSA_FIELDS : DEFAULT_ASS_FIELDS);
    const parsed = assDialogueParts(entry.line, active);
    const shiftedStart = parsed.start + ms;
    const shiftedEnd = parsed.end + ms;
    if (/^\s*Comment\s*:/i.test(entry.line)) {
      // Comment events carry no cues; keep them synchronized with the timeline.
      const parts = parsed.parts.slice();
      parts[parsed.startIndex] = replaceTimeField(parts[parsed.startIndex], shiftedStart);
      parts[parsed.endIndex] = replaceTimeField(parts[parsed.endIndex], shiftedEnd);
      result.push({ line: `${entry.line.match(/^(\s*Comment\s*:\s?)/i)[1]}${parts.join(',')}`, sep: entry.sep });
      continue;
    }
    cueCount++;
    if (drop && shiftedEnd <= 0) continue;
    const parts = parsed.parts.slice();
    parts[parsed.startIndex] = replaceTimeField(parts[parsed.startIndex], Math.max(0, shiftedStart));
    parts[parsed.endIndex] = replaceTimeField(parts[parsed.endIndex], Math.max(0, shiftedEnd));
    const prefixMatch = entry.line.match(/^(\s*Dialogue\s*:\s?)/i);
    result.push({ line: `${prefixMatch ? prefixMatch[1] : 'Dialogue: '}${parts.join(',')}`, sep: entry.sep });
  }
  return { text: result.map((entry) => entry.line + entry.sep).join(''), cueCount: drop ? 0 : cueCount };
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
  const fmt = normalizeFormat(format);
  return { srt: '.srt', vtt: '.vtt', ass: '.ass', ssa: '.ssa', ttml: '.ttml' }[fmt] || '.srt';
}

function utf8Output(text, originalBuffer) {
  return encodeText(text, hasUtf8Bom(originalBuffer) ? 'utf-8bom' : 'utf-8');
}

function convertBuffer(buf, targetFormat, { sourceFormat, sourceCharset } = {}) {
  const target = normalizeFormat(targetFormat);
  if (!target) throw unsupportedFormat(targetFormat);
  const decoded = requireUnambiguous(decodeBuffer(buf, { sourceCharset }));
  const requestedSource = sourceFormat == null ? null : normalizeFormat(sourceFormat);
  if (sourceFormat != null && !requestedSource) throw unsupportedFormat(sourceFormat);
  const parsed = parse(decoded.text, requestedSource || undefined);
  const fromFormat = parsed.format;
  if (fromFormat === target && (fromFormat === 'ass' || fromFormat === 'ssa') && decoded.charset === 'utf-8') {
    return { buffer: Buffer.from(buf), fromFormat, cueCount: parsed.cues.length, targetFormat: target, ...charsetMetadata(decoded) };
  }
  const outText = write(parsed.cues, target);
  return {
    buffer: Buffer.from(outText, 'utf8'),
    fromFormat,
    cueCount: parsed.cues.length,
    targetFormat: target,
    ...charsetMetadata(decoded)
  };
}

function reencodeBuffer(buf, targetCharset, { sourceCharset } = {}) {
  const decoded = requireUnambiguous(decodeBuffer(buf, { sourceCharset }));
  const buffer = encodeText(decoded.text, targetCharset);
  return { buffer, fromCharset: decoded.charset, ...charsetMetadata(decoded) };
}

function shiftBuffer(buf, ms, { drop = false, sourceFormat, sourceCharset } = {}) {
  if (!Number.isFinite(Number(ms))) throw parseError('Subtitle shift offset must be finite.');
  const decoded = requireUnambiguous(decodeBuffer(buf, { sourceCharset }));
  const requestedSource = sourceFormat == null ? null : normalizeFormat(sourceFormat);
  if (sourceFormat != null && !requestedSource) throw unsupportedFormat(sourceFormat);
  const parsed = parse(decoded.text, requestedSource || undefined);
  if (parsed.format === 'ass' || parsed.format === 'ssa') {
    const shifted = shiftAssText(decoded.text, Number(ms), { drop });
    return { buffer: utf8Output(shifted.text, buf), cueCount: shifted.cueCount, ...charsetMetadata(decoded) };
  }
  const shifted = shiftCues(parsed.cues, Number(ms), { drop });
  return { buffer: utf8Output(write(shifted, parsed.format), buf), cueCount: shifted.length, ...charsetMetadata(decoded) };
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
  decodeXmlEntities,
  CHARSET_LABELS,
  EXT_FORMATS,
  extOfFormat
};
