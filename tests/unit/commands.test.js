const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildJobCommands,
  outputExtFor,
  atempoChain,
  secToTime,
  concatListContent
} = require('../../electron/engine/commands');

const IN = '/media/input video.mp4';
const OUT = '/media/out.mp4';
const baseCtx = { hasAudio: true, hasVideo: true, probe: { video: { codec: 'h264' }, audio: { codec: 'aac' } } };

function argsOf(op, params = {}, ctx = baseCtx, inputs = [IN], out = OUT) {
  const built = buildJobCommands(op, params, inputs, out, ctx);
  assert.ok(built, `${op} should build`);
  return built.steps[0].args;
}

test('video.convert builds h264+aac with faststart', () => {
  const args = argsOf('video.convert', { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', crf: 20, preset: 'medium' });
  assert.ok(args.includes('-c:v'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-crf') + 1], '20');
  assert.ok(args.includes('+faststart'));
});

test('video.convert webm forces vp9+opus', () => {
  const args = argsOf('video.convert', { container: 'webm', videoCodec: 'h264' });
  assert.equal(args[args.indexOf('-c:v') + 1], 'libvpx-vp9');
  assert.equal(args[args.indexOf('-c:a') + 1], 'libopus');
});

test('video.convert hevc in mp4 gets hvc1 tag', () => {
  const args = argsOf('video.convert', { container: 'mp4', videoCodec: 'hevc' });
  assert.equal(args[args.indexOf('-tag:v') + 1], 'hvc1');
});

test('video.trim lossless uses copy and input seeking', () => {
  const args = argsOf('video.trim', { startSec: 5, endSec: 12.5, precise: false });
  assert.equal(args[args.indexOf('-ss') + 1], '00:00:05.000');
  assert.equal(args[args.indexOf('-t') + 1], '7.500');
  assert.ok(args.includes('-c'));
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
  const iIdx = args.indexOf('-i');
  assert.ok(iIdx > args.indexOf('-ss'), '-ss must come before -i');
});

test('video.trim precise re-encodes video', () => {
  const args = argsOf('video.trim', { startSec: 1, endSec: 2, precise: true });
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
});

test('video.merge copy mode writes concat list', () => {
  const built = buildJobCommands('video.merge', { mode: 'copy', container: 'mp4' }, ['/a.mp4', '/b.mkv'], '/media/out.mp4', baseCtx);
  assert.ok(built.auxFiles[0].name === 'concat.txt');
  assert.match(built.auxFiles[0].content, /file '\/a\.mp4'/);
  assert.match(built.steps[0].args.join(' '), /-f concat -safe 0 (-threads 0 )?-i concat\.txt/);
});

test('video.merge auto picks reencode for mixed codecs', () => {
  const ctx = { ...baseCtx, allProbes: [
    { video: { codec: 'h264' }, audio: { codec: 'aac' } },
    { video: { codec: 'hevc' }, audio: { codec: 'aac' } }
  ] };
  const args = argsOf('video.merge', { mode: 'auto' }, ctx, ['/a.mp4', '/b.mkv']);
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
});

test('video.speed chains atempo beyond 2x and maps filter outputs', () => {
  const args = argsOf('video.speed', { factor: 4 });
  assert.match(args.join(' '), /atempo=2\.0000,atempo=2\.0000/);
  assert.ok(args.includes('[v]'));
  assert.ok(args.includes('[a]'));
});

test('video.speed without audio uses plain setpts', () => {
  const args = argsOf('video.speed', { factor: 1.5 }, { ...baseCtx, hasAudio: false });
  assert.match(args.join(' '), /setpts=PTS\/1\.5/);
  assert.ok(!args.includes('[a]'));
});

test('video.mute drops audio with -an', () => {
  const args = argsOf('video.mute', {});
  assert.ok(args.includes('-an'));
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
});

test('video.replaceAudio maps video from 0 and audio from 1', () => {
  const args = argsOf('video.replaceAudio', {}, baseCtx, [IN, '/media/new.mp3']);
  assert.ok(args.includes('0:v:0'));
  assert.ok(args.includes('1:a:0'));
  assert.ok(args.includes('-shortest'));
});

test('video.extractAudio copy keeps source codec extension', () => {
  const built = buildJobCommands('video.extractAudio', { format: 'copy' }, [IN], '/media/out.mka', baseCtx);
  assert.match(built.outputPath, /\.m4a$/);
});

test('video.extractAudio mp3 re-encodes', () => {
  const built = buildJobCommands('video.extractAudio', { format: 'mp3', bitrate: 192 }, [IN], '/media/out.mp3', baseCtx);
  assert.equal(built.steps[0].args[built.steps[0].args.indexOf('-c:a') + 1], 'libmp3lame');
});

test('video.extractFrames sequence uses fps filter and pattern', () => {
  const built = buildJobCommands('video.extractFrames', { mode: 'sequence', fps: 2, format: 'png' }, [IN], '/media/frame', baseCtx);
  assert.match(built.outputPath, /frame_%05d\.png$/);
  assert.match(built.steps[0].args.join(' '), /fps=2/);
});

test('video.extractFrames single seeks to time', () => {
  const built = buildJobCommands('video.extractFrames', { mode: 'single', timeSec: 3.5, format: 'jpg' }, [IN], '/media/frame', baseCtx);
  assert.match(built.outputPath, /frame\.jpg$/);
  assert.ok(built.steps[0].args.includes('-frames:v'));
});

test('video.anim gif is two-pass with palettegen/paletteuse', () => {
  const built = buildJobCommands('video.anim', { format: 'gif', fps: 10, width: 320, startSec: 1, endSec: 4 }, [IN], '/media/out.gif', baseCtx);
  assert.equal(built.steps.length, 2);
  assert.match(built.steps[0].args.join(' '), /palettegen/);
  assert.match(built.steps[1].args.join(' '), /paletteuse/);
  assert.match(built.steps[1].args.join(' '), /palette\.png/);
});

test('video.anim webp uses libwebp_anim single pass', () => {
  const built = buildJobCommands('video.anim', { format: 'webp', quality: 80 }, [IN], '/media/out.webp', baseCtx);
  assert.equal(built.steps.length, 1);
  assert.equal(built.steps[0].args[built.steps[0].args.indexOf('-c:v') + 1], 'libwebp_anim');
});

test('video.embedSubs mp4 uses mov_text and maps all inputs', () => {
  const args = argsOf('video.embedSubs', { container: 'mp4', languages: ['chi'] }, baseCtx, [IN, '/media/sub.srt']);
  assert.equal(args[args.indexOf('-c:s') + 1], 'mov_text');
  assert.ok(args.includes('-map'));
  assert.ok(args.join(' ').includes('language=chi'));
});

test('video.embedSubs mkv copies subtitle stream', () => {
  const args = argsOf('video.embedSubs', { container: 'mkv' }, baseCtx, [IN, '/media/sub.srt']);
  assert.equal(args[args.indexOf('-c:s') + 1], 'copy');
});

test('video.burnSubs references temp subtitle without path escaping', () => {
  const ctx = { ...baseCtx, subFormats: ['srt'] };
  const args = argsOf('video.burnSubs', { fontSize: 28 }, ctx, [IN]);
  assert.match(args.join(' '), /subtitles=filename=sub0\.srt/);
  assert.match(args.join(' '), /FontSize=28/);
});

test('video.burnSubs ass skips force_style', () => {
  const ctx = { ...baseCtx, subFormats: ['ass'] };
  const args = argsOf('video.burnSubs', { fontSize: 28 }, ctx, [IN]);
  assert.doesNotMatch(args.join(' '), /force_style/);
});

test('video.remux is stream copy', () => {
  const args = argsOf('video.remux', { container: 'mkv' });
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
});

test('video.metadata returns null (no ffmpeg run)', () => {
  assert.equal(buildJobCommands('video.metadata', {}, [IN], OUT, baseCtx), null);
});

test('audio.loudnorm uses EBU R128 params', () => {
  const args = argsOf('audio.loudnorm', { target: -16, tp: -1.5, lra: 11 });
  assert.match(args.join(' '), /loudnorm=I=-16:TP=-1\.5:LRA=11/);
});

test('audio.volume uses dB filter', () => {
  const args = argsOf('audio.volume', { db: -6 });
  assert.match(args.join(' '), /volume=-6dB/);
});

test('audio.trim copies audio stream', () => {
  const args = argsOf('audio.trim', { startSec: 10, endSec: 20 });
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
});

test('subtitle.extract maps requested stream and encoder', () => {
  const built = buildJobCommands('subtitle.extract', { streamIndex: 2, format: 'srt' }, [IN], '/media/out.srt', baseCtx);
  assert.ok(built.steps[0].args.includes('0:s:2'));
  assert.equal(built.steps[0].args[built.steps[0].args.indexOf('-c:s') + 1], 'subrip');
});

test('every command includes progress reporting', () => {
  for (const args of [
    argsOf('video.convert', { container: 'mp4' }),
    argsOf('video.mute', {})
  ]) {
    assert.ok(args.includes('-progress'), 'should have -progress');
  }
});

test('atempoChain clamps into 0.5-2 range', () => {
  assert.equal(atempoChain(4), 'atempo=2.0000,atempo=2.0000');
  assert.equal(atempoChain(0.25), 'atempo=0.5000,atempo=0.5000');
  assert.equal(atempoChain(1.5), 'atempo=1.5000');
});

test('secToTime formats hours/minutes/seconds', () => {
  assert.equal(secToTime(3661.5), '01:01:01.500');
  assert.equal(secToTime(0), '00:00:00.000');
});

test('concatListContent escapes single quotes', () => {
  assert.match(concatListContent(["/it's.mp4"]), /file '\/it\\'s\.mp4'/);
  assert.match(concatListContent(['/a\\b.mp4']), /file '\/a\\\\b\.mp4'/);
});

test('outputExtFor picks container extension', () => {
  assert.equal(outputExtFor('video.convert', { container: 'mkv' }, IN, baseCtx), '.mkv');
  assert.equal(outputExtFor('video.anim', { format: 'webp' }, IN, baseCtx), '.webp');
  assert.equal(outputExtFor('audio.convert', { format: 'flac' }, IN, baseCtx), '.flac');
});

// ------------------------------------------------- new: encode speed / AV1

test('AV1 encode speed maps to SVT-AV1 numeric presets', () => {
  const slow = argsOf('video.convert', { container: 'mp4', videoCodec: 'av1', crf: 30, encodeSpeed: 'slow' });
  assert.equal(slow[slow.indexOf('-preset') + 1], '4');
  const fast = argsOf('video.convert', { container: 'mp4', videoCodec: 'av1', crf: 30, encodeSpeed: 'fast' });
  assert.equal(fast[fast.indexOf('-preset') + 1], '8');
  // Default (no encodeSpeed) still applies a preset — the old AV1 bug.
  const dflt = argsOf('video.convert', { container: 'mp4', videoCodec: 'av1', crf: 30 });
  assert.equal(dflt[dflt.indexOf('-preset') + 1], '6');
});

test('h264 encode speed maps to libx264 presets', () => {
  const args = argsOf('video.convert', { container: 'mp4', videoCodec: 'h264', crf: 20, encodeSpeed: 'slow' });
  assert.equal(args[args.indexOf('-preset') + 1], 'slow');
});

test('vp9 encode speed maps to cpu-used', () => {
  const args = argsOf('video.convert', { container: 'webm', encodeSpeed: 'fast' });
  assert.equal(args[args.indexOf('-cpu-used') + 1], '5');
  assert.ok(args.includes('-deadline'));
});

test('bitrate mode uses kbps numbers with the k suffix', () => {
  const args = argsOf('video.convert', { container: 'mp4', videoCodec: 'h264', mode: 'bitrate', videoBitrate: 22118 });
  const i = args.indexOf('-b:v');
  assert.equal(args[i + 1], '22118k');
  // No CRF in bitrate mode.
  assert.ok(!args.includes('-crf'));
});

test('AVI container forces MPEG-4 video; copy/opus audio becomes MP3', () => {
  const args = argsOf('video.convert', { container: 'avi', videoCodec: 'h264', audioCodec: 'aac', crf: 20 });
  assert.equal(args[args.indexOf('-c:v') + 1], 'mpeg4');
  // AAC is legal in AVI and stays; stream copy / Opus are not and become MP3.
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  const forced = argsOf('video.convert', { container: 'avi', videoCodec: 'h264', audioCodec: 'copy' });
  assert.equal(forced[forced.indexOf('-c:a') + 1], 'libmp3lame');
});

test('GPU VideoToolbox encoder is passed through with bitrate control', () => {
  const args = argsOf('video.convert', { container: 'mp4', videoCodec: 'h264_videotoolbox', mode: 'bitrate', videoBitrate: 8000 });
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox');
  assert.equal(args[args.indexOf('-b:v') + 1], '8000k');
  assert.ok(!args.includes('-crf'), 'VideoToolbox has no CRF');
});

test('burnSubs uses the UI margin field for MarginV', () => {
  const ctx = { ...baseCtx, subFormats: ['srt'] };
  const args = argsOf('video.burnSubs', { fontSize: 28, margin: 45 }, ctx, [IN]);
  assert.match(args.join(' '), /MarginV=45/);
});

test('embedSubs output extension follows the container', () => {
  assert.equal(outputExtFor('video.embedSubs', { container: 'mkv' }, IN, baseCtx), '.mkv');
  assert.equal(outputExtFor('video.embedSubs', { container: 'mp4' }, IN, baseCtx), '.mp4');
  // subtitle.mux maps to video.embedSubs with the same rule.
  assert.equal(outputExtFor('video.embedSubs', { container: 'mp4' }, IN, baseCtx), '.mp4');
});

test('merge re-encode mode applies encode speed', () => {
  const ctx = { ...baseCtx, allProbes: [
    { video: { codec: 'h264' }, audio: { codec: 'aac' } },
    { video: { codec: 'hevc' }, audio: { codec: 'aac' } }
  ] };
  const args = argsOf('video.merge', { mode: 'reencode', videoCodec: 'h264', encodeSpeed: 'fast' }, ctx, ['/a.mp4', '/b.mkv']);
  assert.equal(args[args.indexOf('-preset') + 1], 'fast');
});

// --------------------------- compress honors the resolved codec (regression)

test('compress uses the resolved videoCodec, not the source family', () => {
  const gpu = argsOf('video.compress', { videoCodec: 'h264_videotoolbox', mode: 'bitrate', videoBitrate: 6000 }, baseCtx, [IN]);
  assert.equal(gpu[gpu.indexOf('-c:v') + 1], 'h264_videotoolbox');
  assert.equal(gpu[gpu.indexOf('-b:v') + 1], '6000k');

  const hevc = argsOf('video.compress', { videoCodec: 'hevc', crf: 26, mode: 'crf' }, baseCtx, [IN]);
  assert.equal(hevc[hevc.indexOf('-c:v') + 1], 'libx265');

  // No resolved codec -> falls back to the source family (h264 source here).
  const fallback = argsOf('video.compress', { crf: 26, mode: 'crf' }, baseCtx, [IN]);
  assert.equal(fallback[fallback.indexOf('-c:v') + 1], 'libx264');
});

// ------------------------- re-encode ops with WebM/AVI input land in MP4

test('outputExtFor forces MP4 for re-encode ops on WebM input', () => {
  const WEBM = '/media/input video.webm';
  assert.equal(outputExtFor('video.crop', {}, WEBM, baseCtx), '.mp4');
  assert.equal(outputExtFor('video.scale', {}, WEBM, baseCtx), '.mp4');
  assert.equal(outputExtFor('video.rotate', {}, WEBM, baseCtx), '.mp4');
  assert.equal(outputExtFor('video.speed', {}, WEBM, baseCtx), '.mp4');
  assert.equal(outputExtFor('video.burnSubs', {}, WEBM, baseCtx), '.mp4');
  assert.equal(outputExtFor('video.trim', { precise: true }, WEBM, baseCtx), '.mp4');
  // Lossless trim keeps the source container (stream copy is always legal).
  assert.equal(outputExtFor('video.trim', { precise: false }, WEBM, baseCtx), '.webm');
  // MP4/MKV/MOV inputs keep their extension.
  assert.equal(outputExtFor('video.crop', {}, IN, baseCtx), '.mp4');
  assert.equal(outputExtFor('video.crop', {}, '/media/input.mkv', baseCtx), '.mkv');
});

test('replaceAudio on WebM input gets an MP4 output (vp9 copy + aac)', () => {
  const WEBM = '/media/input.webm';
  // Production resolves the output to .mp4 (see outputExtFor) — AAC lands there.
  assert.equal(outputExtFor('video.replaceAudio', {}, WEBM, baseCtx), '.mp4');
  const built = buildJobCommands('video.replaceAudio', {}, [WEBM, '/media/new.mp3'], '/media/out.mp4', baseCtx);
  const args = built.steps[0].args;
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  // Defensive path: a .webm output would use Opus (WebM cannot hold AAC).
  const defensive = buildJobCommands('video.replaceAudio', {}, [WEBM, '/media/new.mp3'], '/media/out.webm', baseCtx);
  assert.equal(defensive.steps[0].args[defensive.steps[0].args.indexOf('-c:a') + 1], 'libopus');
});

// --------------- re-encode ops: audio must survive the container switch

test('re-encode ops re-encode Opus audio when landing in MP4', () => {
  // WebM source (VP9 + Opus) cropped into an MP4: copying Opus into MP4
  // "succeeds" but plays in almost no real player — must become AAC.
  const webmCtx = { ...baseCtx, probe: { video: { codec: 'vp9' }, audio: { codec: 'opus' } } };
  for (const op of ['video.crop', 'video.scale', 'video.rotate', 'video.burnSubs']) {
    const ctx = op === 'video.burnSubs' ? { ...webmCtx, subFormats: ['srt'] } : webmCtx;
    const args = argsOf(op, op === 'video.crop' ? { w: 320, h: 180 } : { width: 320, height: 180, mode: 'fit' }, ctx, ['/in/sample.webm'], '/out/sample.mp4');
    assert.equal(args[args.indexOf('-c:a') + 1], 'aac', `${op} must re-encode Opus to AAC in MP4`);
  }
  const trimArgs = argsOf('video.trim', { startSec: 1, endSec: 2, precise: true }, webmCtx, ['/in/sample.webm'], '/out/sample.mp4');
  assert.equal(trimArgs[trimArgs.indexOf('-c:a') + 1], 'aac');
});

test('re-encode ops keep stream copy when the container can hold the audio', () => {
  // MP4 + AAC source: copy is correct.
  const args = argsOf('video.crop', { w: 320, h: 180 }, baseCtx, [IN], '/out/out.mp4');
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  // MKV holds Opus natively: copy stays even though the video is re-encoded.
  const mkvCtx = { ...baseCtx, probe: { video: { codec: 'h264' }, audio: { codec: 'opus' } } };
  const mkvArgs = argsOf('video.crop', { w: 320, h: 180 }, mkvCtx, ['/in/s.mkv'], '/out/s.mkv');
  assert.equal(mkvArgs[mkvArgs.indexOf('-c:a') + 1], 'copy');
});

test('commands audio copyability table mirrors shared/resolve.mjs', async () => {
  const { REENCODE_COPYABLE_AUDIO } = require('../../electron/engine/commands');
  const resolve = await import('../../shared/resolve.mjs');
  for (const container of ['mp4', 'mov', 'mkv']) {
    assert.deepStrictEqual(
      [...REENCODE_COPYABLE_AUDIO[container]].sort(),
      [...resolve.COPYABLE_AUDIO[container]].sort(),
      `${container} audio copyability must match between commands and resolver`
    );
  }
});
