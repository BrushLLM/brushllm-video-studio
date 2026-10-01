// Pre-processing hooks that run before command building for subtitle jobs.
// Ensures burned / embedded subtitles are UTF-8 and in a container-friendly
// format, written into the job temp dir (referenced by bare filename).
const fs = require('node:fs');
const path = require('node:path');
const subs = require('../../shared/subtitles');

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
    const { text } = subs.decodeBuffer(buf);
    const parsed = subs.parse(text);
    // Keep ASS styling when the source is ASS; everything else becomes SRT.
    const target = parsed.format === 'ass' || parsed.format === 'ssa' ? 'ass' : 'srt';
    const outName = `sub${i}${target === 'ass' ? '.ass' : '.srt'}`;
    fs.writeFileSync(path.join(tmpDir, outName), subs.write(parsed.cues, target), 'utf8');
    prepared.push(outName);
    formats.push(target);
  });

  if (op === 'video.burnSubs' || op === 'subtitle.burn') {
    // Burn only uses the first subtitle; the command references sub0.<ext>.
    return { inputs: [inputs[0]], subFormats: formats };
  }
  return { inputs: [inputs[0], ...prepared], subFormats: formats };
}

module.exports = { prepareInputs };
