// Effective encoding for filterless transcodes ONLY. Other operations own their
// stream mappings and mode semantics (merge/scale modes are not rate control).
import contract from './media-contract.json' with { type: 'json' };
import { containerOfSource } from './media.mjs';
import { validateOperation } from './validation.mjs';

export const SUPPORTED_GPU_ENCODERS = Object.freeze([...contract.gpuEncoders]);
export const GPU_H264_BY_PREFERENCE = ['h264_videotoolbox'];
export const GPU_HEVC_BY_PREFERENCE = ['hevc_videotoolbox'];
export const COPYABLE_AUDIO = contract.copyableAudio;
export function isGpuEncoder(codec) { return SUPPORTED_GPU_ENCODERS.includes(codec); }
const family = codec => isGpuEncoder(codec) ? codec.split('_')[0] : codec;
const defaults = { mp4: 'aac', mov: 'aac', mkv: 'aac', webm: 'opus', avi: 'mp3' };
const tiers = { compat: 6000, balanced: 5000, quality: 8000, small: 3500 };
const num = (value, fallback) => value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value);

export function containerForcedVideo(container, codec) {
  if (container === 'webm') return ['vp8', 'vp9', 'av1'].includes(codec) ? codec : 'vp9';
  if (container === 'avi' && !['mpeg4', 'copy'].includes(codec)) return 'mpeg4';
  return codec;
}

export function defaultGpuBitrate(preset, source) {
  const scale = num(source?.video?.width, 1920) * num(source?.video?.height, 1080) / (1920 * 1080);
  return Math.round(Math.min(60000, Math.max(1500, (tiers[preset] || tiers.balanced) * Math.max(0.25, scale))));
}

export function mpeg4Quality(crf) {
  return Math.max(2, Math.min(31, Math.round(num(crf, 20) * 29 / 51 + 2)));
}

export function resolveEncoding(op, params, source, opts = {}) {
  const p = params || {};
  if (!['video.convert', 'video.compress'].includes(op)) return { passthrough: true, hw: false, cpuNote: false };
  const errors = validateOperation(op, p, source);
  if (errors.length) return { error: errors[0].message, issues: errors };
  const sourceContainer = containerOfSource(source || {});
  const container = op === 'video.compress'
    ? (contract.containers[sourceContainer] ? sourceContainer : 'mp4')
    : p.container || 'mp4';
  if (!contract.containers[container]) return { error: `Unsupported output container: ${container}` };
  const srcFamily = ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4'].includes(source?.video?.codec) ? source.video.codec : 'h264';
  let videoCodec = p.videoCodec || (op === 'video.compress' ? srcFamily : 'h264');
  if (!contract.videoEncoders[videoCodec]) return { error: `Unsupported video encoder: ${videoCodec}` };
  const strategy = p.hwStrategy || 'auto';
  if (!['auto', 'cpu', 'gpu'].includes(strategy)) return { error: 'Unsupported hardware strategy' };
  if (strategy === 'cpu') videoCodec = family(videoCodec);
  const forced = containerForcedVideo(container, videoCodec);
  if (strategy === 'gpu' && (forced !== videoCodec || !['h264', 'hevc'].includes(family(videoCodec)))) return { error: 'gpu-container-conflict' };
  videoCodec = forced;
  if (container === 'mov' && !(contract.copyableVideo.mov.includes(family(videoCodec)))) return { error: `MOV does not support ${videoCodec}; choose MP4/MKV or a compatible video codec` };
  if (videoCodec === 'copy' && !contract.copyableVideo[container].includes(source?.video?.codec)) return { error: `Cannot copy source video to ${container}` };
  let hw = false;
  let cpuNote = false;
  if (isGpuEncoder(videoCodec)) {
    // An explicitly resolved GPU encoder stays concrete: main.js already
    // validated it against the detected snapshot when it chose this codec.
    hw = true;
    if (strategy === 'cpu') {
      videoCodec = family(videoCodec);
      hw = false;
      cpuNote = true;
    }
  } else if (strategy !== 'cpu' && ['h264', 'hevc'].includes(family(videoCodec))) {
    const target = `${family(videoCodec)}_videotoolbox`;
    if ((opts.gpuEncoders || []).includes(target)) { videoCodec = target; hw = true; }
    else if (strategy === 'gpu') return { error: 'gpu-unavailable' };
    else cpuNote = true;
  }
  let mode = p.rateControl || p.mode || 'crf';
  let crf = num(p.crf, 20);
  let videoBitrate = num(p.videoBitrate, null);
  let qscale = null;
  if (hw) {
    mode = 'bitrate';
    if (!(videoBitrate > 0)) videoBitrate = defaultGpuBitrate(p.qualityPreset, source);
    crf = null;
  } else if (mode === 'bitrate') crf = null;
  else {
    videoBitrate = null;
    if (videoCodec === 'mpeg4') { mode = 'qscale'; qscale = num(p.qscale, mpeg4Quality(crf)); crf = null; }
    else mode = 'crf';
  }
  let audioCodec = p.audioCodec || 'auto';
  const srcAudio = source?.audio?.codec;
  const canCopy = COPYABLE_AUDIO[container].includes(srcAudio);
  if (audioCodec === 'auto' || audioCodec === 'copy') audioCodec = canCopy ? 'copy' : defaults[container];
  else {
    const canonical = contract.audioFormats[audioCodec]?.codec || audioCodec;
    if (!contract.audioEncoders[audioCodec]) return { error: `Unsupported audio encoder: ${audioCodec}` };
    if (!COPYABLE_AUDIO[container].includes(canonical)) {
      if (container === 'mov') return { error: `MOV does not support ${canonical}; choose a compatible audio codec` };
      audioCodec = defaults[container];
    }
  }
  const resolved = {
    container, videoCodec, audioCodec, audioCopy: Boolean(srcAudio) && audioCodec === 'copy',
    mode, crf, qscale, videoBitrate: videoBitrate > 0 ? Math.round(videoBitrate) : null,
    encodeSpeed: p.encodeSpeed || 'fast', audioBitrate: num(p.audioBitrate, 128),
    hw, cpuNote, qualityPreset: p.qualityPreset || null
  };
  const finalErrors = validateOperation(op, { ...p, ...resolved }, source);
  return finalErrors.length ? { error: finalErrors[0].message, issues: finalErrors } : resolved;
}

export function applyResolved(params, resolved) {
  if (!resolved || resolved.passthrough) return { ...params };
  if (resolved.error) throw new Error(resolved.error);
  const { container, videoCodec, audioCodec, mode, crf, qscale, videoBitrate, encodeSpeed, audioBitrate } = resolved;
  return { ...params, container, videoCodec, audioCodec, mode, crf, qscale, videoBitrate, encodeSpeed, audioBitrate };
}
