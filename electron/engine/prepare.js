// Pre-processing hooks that run before command building for subtitle jobs.
// Ensures burned / embedded subtitles are UTF-8 and in a container-friendly
// format, written into the job temp dir (referenced by bare filename).
//
// ASS/SSA documents are passed through byte-for-byte when already UTF-8 —
// parsing and re-writing them would drop styles, fonts and unknown sections.
const fs = require('node:fs');
const path = require('node:path');
const subs = require('../../shared/subtitles');

const ASS_FAMILY = new Set(['ass', 'ssa']);

function decodeForPrepare(buf, params) {
  const sourceCharset = params && typeof params.sourceCharset === 'string' && params.sourceCharset !== 'auto'
    ? params.sourceCharset
    : undefined;
  const decoded = subs.decodeBuffer(buf, { sourceCharset });
  if (decoded.ambiguous) {
    const error = new Error('Subtitle encoding is ambiguous; select the source encoding before processing this file.');
    error.code = 'SUBTITLE_CHARSET_AMBIGUOUS';
    throw error;
  }
  return decoded;
}

// Returns { inputs, subFormats } — rewritten input list + subtitle formats.
function prepareInputs(op, params, inputs, tmpDir) {
  if (op !== 'video.burnSubs' && op !== 'video.embedSubs' && op !== 'subtitle.burn' && op !== 'subtitle.mux') {
    return { inputs, subFormats: [] };
  }

  const subInputs = inputs.slice(1);
  const prepared = [];
  const formats = [];

  subInputs.forEach((subPath, i) => {
    const buf = fs.readFileSync(subPath);
    const decoded = decodeForPrepare(buf, params);
    const detected = subs.detectFormat(decoded.text);
    if (ASS_FAMILY.has(detected)) {
      // Keep the full document (styles, fonts, unknown sections, BOM, CRLF).
      // libass reads SSA content from an .ass file by content sniffing.
      const outName = `sub${i}.ass`;
      const isUtf8 = decoded.charset === 'utf-8' || decoded.charset === 'utf-8bom';
      fs.writeFileSync(path.join(tmpDir, outName), isUtf8 ? buf : Buffer.from(decoded.text, 'utf8'));
      prepared.push(outName);
      formats.push('ass');
      return;
    }
    if (detected === 'ttml') {
      // TTML cannot be burned/embedded directly; convert through the cue model.
      // parse() throws SUBTITLE_PARSE_ERROR / SUBTITLE_UNSUPPORTED_TTML on
      // content we cannot faithfully read — never an empty success.
      const parsed = subs.parse(decoded.text, 'ttml');
      if (!parsed.cues.length) {
        const error = new Error('TTML document contains no subtitle cues.');
        error.code = 'SUBTITLE_PARSE_ERROR';
        throw error;
      }
      const outName = `sub${i}.srt`;
      fs.writeFileSync(path.join(tmpDir, outName), subs.write(parsed.cues, 'srt'), 'utf8');
      prepared.push(outName);
      formats.push('srt');
      return;
    }
    const parsed = subs.parse(decoded.text, detected || undefined);
    if (!parsed.cues.length) {
      const error = new Error('Subtitle file contains no cues.');
      error.code = 'SUBTITLE_PARSE_ERROR';
      throw error;
    }
    const outName = `sub${i}.srt`;
    fs.writeFileSync(path.join(tmpDir, outName), subs.write(parsed.cues, 'srt'), 'utf8');
    prepared.push(outName);
    formats.push('srt');
  });

  if (op === 'video.burnSubs' || op === 'subtitle.burn') {
    // Burn only uses the first subtitle; the command references sub0.<ext>.
    return { inputs: [inputs[0]], subFormats: formats };
  }
  return { inputs: [inputs[0], ...prepared], subFormats: formats };
}

module.exports = { prepareInputs };
