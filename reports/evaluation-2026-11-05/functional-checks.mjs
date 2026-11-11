import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const { probe, summarize } = require(path.join(root, 'electron/engine/probe.js'));
const { resolveBinaries } = require(path.join(root, 'electron/engine/binaries.js'));
const { buildJobCommands, outputExtFor } = require(path.join(root, 'electron/engine/commands.js'));
const { prepareInputs } = require(path.join(root, 'electron/engine/prepare.js'));
const { JobManager } = require(path.join(root, 'electron/engine/queue.js'));
const { buildPlan } = await import(path.join(root, 'shared/plan.mjs'));
const { resolveEncoding, applyResolved } = await import(path.join(root, 'shared/resolve.mjs'));
const { mergeCopyCompatibility } = require(path.join(root, 'shared/media.cjs'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'brushvs-evaluation-'));
const input = path.join(root, 'tests/media/out/sample.mp4');
const binaries = resolveBinaries();
const source = summarize(await probe(binaries.ffprobe, input), input);
const manager = new JobManager(binaries);
const params = { container: 'webm', videoCodec: 'av1', crf: 30, encodeSpeed: 'fast', audioCodec: 'auto', hwStrategy: 'cpu' };
const resolved = resolveEncoding('video.convert', params, source, { gpuEncoders: [] });
const plan = buildPlan('video.convert', params, source, { gpuEncoders: [] });
const completed = new Promise((resolve, reject) => {
  manager.on('updated', j => { if (j.status === 'done') resolve(j); else if (j.status === 'error') reject(new Error(j.error)); });
});
await manager.add({ op:'video.convert', params:applyResolved(params,resolved), requestedParams:params, gpuEncoders:[], inputs:[input], outputPath:path.join(work,'av1-request.webm') });
const job = await completed;
console.log(JSON.stringify({ check:'WebM AV1', requested:params.videoCodec, resolved:resolved.videoCodec, plan:plan.videoEncoderLabel, actual:job.actual.videoEncoderLabel, status:job.status }));
const sourceWebm = { ...source, formatName:'matroska,webm', video:{...source.video,codec:'vp9'}, audio:{...source.audio,codec:'opus'} };
const scalePlan = buildPlan('video.scale',{size:'720p',width:1280,height:720,mode:'fit'},sourceWebm);
console.log(JSON.stringify({ check:'WebM scale container', plan:scalePlan.containerLabel, outputExtension:outputExtFor('video.scale',{},'input.webm',{probe:sourceWebm}) }));
const second = structuredClone(source);
second.video.width = source.video.width * 2;
second.videoStreams[0].width = second.video.width;
second.streams.find(s => s.type === 'video').width = second.video.width;
const mergeParams = { mode:'auto',container:'mp4' };
const mergePlan = buildPlan('video.merge', mergeParams, source, { allProbes:[source,second] });
const mergeBuilt = buildJobCommands('video.merge',mergeParams,[input,input],path.join(work,'merge.mp4'),{probe:source,allProbes:[source,second]});
console.log(JSON.stringify({check:'merge same codec, differing dimensions',plan:mergePlan.qualityLabel,copyCompatible:mergeCopyCompatibility([source,second]).compatible,actualUsesFilter:mergeBuilt.steps[0].args.includes('-filter_complex')}));
const subPath = path.join(work,'gbk.srt');
fs.writeFileSync(subPath,Buffer.concat([Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n'),Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('\n')]));
for (const p of [{},{sourceCharset:'gbk'}]) {
  try { prepareInputs('video.burnSubs',p,[input,subPath],work); console.log(JSON.stringify({check:'GBK burn preparation',params:p,success:true})); }
  catch(e) { console.log(JSON.stringify({check:'GBK burn preparation',params:p,success:false,code:e.code,error:e.message})); }
}
await manager.shutdown();
fs.rmSync(work,{recursive:true,force:true});

const { OPS, defaultParams, engineParams } = await import(path.join(root, 'src/ops.js'));
const { validateOperation } = await import(path.join(root, 'shared/validation.mjs'));
const audioOp = OPS.find(o => o.id === 'audio.convert');
const audioParams = engineParams(audioOp.id, defaultParams(audioOp), []);
console.log(JSON.stringify({check:'audio default conversion',params:audioParams,issues:validateOperation(audioOp.id,audioParams,{audio:{codec:'mp3',sampleRate:44100,channels:2}})}));
