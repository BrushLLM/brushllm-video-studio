const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { convertBuffer, shiftBuffer, reencodeBuffer, extOfFormat } = require('../../shared/subtitles');
const { writeNewFile, replaceWithBackup } = require('./artifacts');

const operations = {
  'subtitle.convert': {
    convert: (buffer, params, options) => convertBuffer(buffer, params.targetFormat, options),
    suffix: (_, result) => extOfFormat(result.targetFormat),
    canOverwrite: false
  },
  'subtitle.shift': {
    convert: (buffer, params, options) => shiftBuffer(buffer, params.offsetMs, options),
    suffix: (ext) => `-shifted${ext}`,
    canOverwrite: true
  },
  'subtitle.reencode': {
    convert: (buffer, params, options) => reencodeBuffer(buffer, params.charset, options),
    suffix: (ext, _result, params) => `-${params.charset.trim()}${ext}`,
    canOverwrite: true
  }
};

async function processSubtitleBatch({ op, inputs, params, sourceCharset } = {}) {
  if (!Object.hasOwn(operations, op) || !Array.isArray(inputs) || !inputs.length ||
      !params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid subtitle batch');
  const operation = operations[op];
  const results = [];
  for (const input of inputs) {
    try {
      if (typeof input !== 'string' || !path.isAbsolute(input) || !(await stat(input)).isFile()) throw new Error('Invalid subtitle path');
      const buffer = await readFile(input);
      const result = operation.convert(buffer, params, { sourceCharset });
      if (result.cueCount === 0) throw new Error('No subtitle cues were parsed; the original file was not changed.');
      let outputPath;
      if (operation.canOverwrite && params.overwrite === true) {
        outputPath = replaceWithBackup(input, buffer, result.buffer).outputPath;
      } else {
        const ext = path.extname(input);
        const base = path.basename(input, ext);
        const suffix = operation.suffix(ext, result, params);
        outputPath = writeNewFile(path.join(path.dirname(input), base + suffix), result.buffer);
      }
      results.push({ input, outputPath });
    } catch (error) {
      results.push({ input, error: error.message || String(error) });
    }
  }
  return results;
}

module.exports = { processSubtitleBatch };
