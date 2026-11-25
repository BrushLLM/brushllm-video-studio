const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { processSubtitleBatch } = require('../../electron/engine/subtitle-files');

test('a damaged subtitle keeps its original while other batch inputs finish', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'brushvs-subs-batch-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const inputs = ['first.srt', 'damaged.srt', 'last.srt'].map((name) => join(folder, name));
  const valid = '1\n00:00:01,000 --> 00:00:03,000\n一行字幕\n';
  await Promise.all(inputs.map((file, index) => writeFile(file, index === 1 ? 'invalid' : valid)));

  const results = await processSubtitleBatch({ op: 'subtitle.shift', inputs, params: { offsetMs: 2000, overwrite: true } });
  assert.deepEqual(results.map((result) => result.input), inputs);
  assert.match(results[1].error, /no subtitle cues|parse|format/i);
  assert.equal(await readFile(inputs[1], 'utf8'), 'invalid');
  for (const i of [0, 2]) {
    assert.equal(results[i].outputPath, inputs[i]);
    assert.match(await readFile(inputs[i], 'utf8'), /00:00:03,000 --> 00:00:05,000/);
    assert.equal(await readFile(`${inputs[i]}.bak`, 'utf8'), valid);
  }
});

test('subtitle conversion honors explicitly selected GB2312 and Windows-1252', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'brushvs-subs-charset-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const header = Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n');
  const cases = [
    { charset: 'gb2312', text: '中文', bytes: [0xd6, 0xd0, 0xce, 0xc4] },
    { charset: 'windows-1252', text: '€', bytes: [0x80] }
  ];
  for (const { charset, text, bytes } of cases) {
    const input = join(folder, `${charset}.srt`);
    await writeFile(input, Buffer.concat([header, Buffer.from(bytes), Buffer.from('\n')]));
    const [result] = await processSubtitleBatch({
      op: 'subtitle.convert', inputs: [input], params: { targetFormat: 'vtt' }, sourceCharset: charset
    });
    assert.ok(!result.error, result.error);
    assert.ok((await readFile(result.outputPath, 'utf8')).includes(text));
  }
});
