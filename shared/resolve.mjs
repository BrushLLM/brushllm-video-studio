// Central effective-encoding resolver — the single source of truth shared by
// the plan summary (renderer), job submission (main) and the consistency
// tests. commands.js applies the same container rules as final defense.
//
// Everything that decides "which encoder actually runs" lives here:
//   - hardware strategy (auto / cpu / gpu) against really-detected encoders
//   - container constraints (WebM forces VP9+Opus, AVI forces MPEG-4)
//   - GPU encoders are bitrate-driven (no CRF semantics on VideoToolbox)
//   - CRF mode never carries a target bitrate
//   - audio "auto": stream copy when the container can hold the source codec

export const GPU_H264_BY_PREFERENCE = ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf'];
export const GPU_HEVC_BY_PREFERENCE = ['hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf'];
const ALL_GPU = new Set([...GPU_H264_BY_PREFERENCE, ...GPU_HEVC_BY_PREFERENCE]);

export { COPYABLE_AUDIO };

export function isGpuEncoder(codec) {
  return ALL_GPU.has(codec);
}

// Container constraints — mirrored in commands.js (consistency-tested).
export function containerForcedVideo(container, videoCodec) {
  if (container === 'webm') {
    return ['vp9', 'vp8'].includes(videoCodec) ? videoCodec : 'vp9';
  }
  if (container === 'avi') {
    if (['h264', 'hevc', 'av1', ...GPU_H264_BY_PREFERENCE, ...GPU_HEVC_BY_PREFERENCE].includes(videoCodec)) return 'mpeg4';
  }
  return videoCodec;
}

// Which source audio codecs each container can hold without re-encoding.
const COPYABLE_AUDIO = {
  mp4: ['aac', 'mp3', 'ac3', 'eac3', 'alac'],
  mov: ['aac', 'mp3', 'ac3', 'eac3', 'alac'],
  mkv: ['aac', 'mp3', 'ac3', 'eac3', 'flac', 'opus', 'vorbis', 'alac'],
  webm: ['opus', 'vorbis'],
  avi: ['mp3', 'pcm_s16le', 'ac3']
};
const CONTAINER_AUDIO_DEFAULT = { mp4: 'aac', mov: 'aac', mkv: 'aac', webm: 'opus', avi: 'mp3' };

// GPU bitrate defaults per quality preset at 1080p, scaled by resolution.
const GPU_BITRATE_TIERS = { compat: 6000, balanced: 5000, quality: 8000, small: 3500 };

function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// Resolution-scaled default GPU bitrate (kbps), clamped to a sane range.
export function defaultGpuBitrate(preset, source) {
  const base = GPU_BITRATE_TIERS[preset] || GPU_BITRATE_TIERS.balanced;
  const w = num(source && source.video && source.video.width, 1920);
  const h = num(source && source.video && source.video.height, 1080);
  const scale = (w * h) / (1920 * 1080);
  return Math.round(Math.min(60000, Math.max(1500, base * Math.max(0.25, scale))));
}

function pickGpuFor(codec, gpuEncoders) {
  const list = codec === 'hevc' ? GPU_HEVC_BY_PREFERENCE : GPU_H264_BY_PREFERENCE;
  return list.find((e) => gpuEncoders.includes(e)) || null;
}

function resolveAudio(container, audioCodec, source) {
  const srcCodec = (source && source.audio && source.audio.codec) || '';
  const copyable = (COPYABLE_AUDIO[container] || []).includes(srcCodec);
  if (audioCodec === 'auto') {
    return {
      audioCodec: copyable ? 'copy' : (CONTAINER_AUDIO_DEFAULT[container] || 'aac'),
      audioCopy: copyable && Boolean(srcCodec)
    };
  }
  if (audioCodec === 'copy') {
    // Forced copy that the container cannot hold falls back to re-encode,
    // matching commands.js (which cannot copy an incompatible stream either).
    return copyable
      ? { audioCodec: 'copy', audioCopy: true }
      : { audioCodec: CONTAINER_AUDIO_DEFAULT[container] || 'aac', audioCopy: false };
  }
  // Explicit codec the container rejects (e.g. AAC into WebM).
  if (container === 'webm' && !['opus', 'vorbis'].includes(audioCodec)) {
    return { audioCodec: 'opus', audioCopy: false };
  }
  return { audioCodec, audioCopy: false };
}

// Compress keeps the source codec family when no explicit codec/preset
// decided one (advanced mode has no codec picker for compress).
function sourceFamilyCodec(source) {
  const src = (source && source.video && source.video.codec) || '';
  return ['h264', 'hevc', 'vp9', 'av1'].includes(src) ? src : 'h264';
}

// Resolve the encoding that will ACTUALLY run.
// params: UI params (hwStrategy, qualityPreset already resolved into codec by
//         ops.js engineParams, or an explicit advanced videoCodec).
// opts:   { gpuEncoders = [] } — encoders really present in the ffmpeg build.
// Returns { ...effective fields, hw, cpuNote, audioCopy, container } or
//         { error: 'gpu-unavailable' } when the user demanded GPU and none exists.
export function resolveEncoding(op, params, source, opts = {}) {
  const p = params || {};
  const gpuEncoders = (opts && opts.gpuEncoders) || [];

  // Only filterless transcodes participate in hardware acceleration; visual
  // edit ops (crop/scale/rotate/burn) keep the CPU path.
  const HW_ELIGIBLE = ['video.convert', 'video.compress'];
  const hwEligible = HW_ELIGIBLE.includes(op);

  const container = op === 'video.compress'
    ? containerOfSource(source)
    : (p.container || 'mp4');

  // 1. Base codec: explicit (advanced) or preset-resolved; compress without
  //    either keeps the source codec family.
  let videoCodec = p.videoCodec || (op === 'video.compress' ? sourceFamilyCodec(source) : 'h264');

  // An explicit GPU encoder under a CPU strategy is a conflict — the strategy
  // wins and the codec is downgraded to its CPU equivalent (never the other
  // way around, so the UI can never claim GPU while running CPU).
  if (isGpuEncoder(videoCodec) && hwEligible && p.hwStrategy === 'cpu') {
    videoCodec = videoCodec.startsWith('hevc') ? 'hevc' : 'h264';
  }

  // 2. Hardware strategy.
  const strategy = hwEligible ? (p.hwStrategy || 'auto') : 'cpu';
  let hw = false;
  let cpuNote = false;
  if (hwEligible && strategy !== 'cpu' && !['vp9', 'av1', 'mpeg4'].includes(videoCodec)) {
    const gpu = pickGpuFor(videoCodec === 'hevc' ? 'hevc' : 'h264', gpuEncoders);
    if (gpu) {
      videoCodec = gpu;
      hw = true;
    } else if (strategy === 'gpu') {
      return { error: 'gpu-unavailable' };
    } else {
      cpuNote = true; // auto → honest CPU fallback
    }
  }

  // 3. Container constraints (may drop GPU, e.g. WebM cannot hold H.264).
  const forcedVideo = containerForcedVideo(container, videoCodec);
  if (forcedVideo !== videoCodec) {
    videoCodec = forcedVideo;
    hw = false;
    cpuNote = true;
  }

  // 4. Quality mode. GPU encoders are bitrate-driven; CRF never carries a
  //    target bitrate — that mismatch was the original plan/command bug.
  let mode = p.mode || 'crf';
  let crf = num(p.crf, 20);
  let videoBitrate = num(p.videoBitrate, 0);
  if (isGpuEncoder(videoCodec)) {
    mode = 'bitrate';
    if (!(videoBitrate > 0)) videoBitrate = defaultGpuBitrate(p.qualityPreset, source);
    crf = null;
  } else {
    if (mode !== 'bitrate') {
      videoBitrate = null; // CRF mode must not leak a default bitrate
    } else {
      crf = null;
    }
  }

  // 5. Audio: auto = copy when the container can hold it.
  const audio = resolveAudio(container, p.audioCodec || 'auto', source);

  return {
    container,
    videoCodec,
    audioCodec: audio.audioCodec,
    audioCopy: audio.audioCopy,
    mode,
    crf,
    videoBitrate: videoBitrate > 0 ? Math.round(videoBitrate) : null,
    encodeSpeed: p.encodeSpeed || 'fast',
    audioBitrate: num(p.audioBitrate, 128),
    hw,
    cpuNote,
    qualityPreset: p.qualityPreset || null
  };
}

function containerOfSource(src) {
  const name = (src && src.formatName) || '';
  if (name.includes('webm')) return 'webm';
  if (name.includes('matroska')) return 'mkv';
  if (name.includes('avi')) return 'avi';
  if (name.includes('mp4')) return 'mp4';
  if (name.includes('mov')) return 'mov';
  return 'mp4';
}

// Merge resolved values back into engine params (used by main.js before the
// job enters the queue, so commands.js receives final values).
export function applyResolved(params, resolved) {
  return {
    ...params,
    container: resolved.container,
    videoCodec: resolved.videoCodec,
    audioCodec: resolved.audioCodec,
    mode: resolved.mode,
    crf: resolved.crf,
    videoBitrate: resolved.videoBitrate,
    encodeSpeed: resolved.encodeSpeed,
    audioBitrate: resolved.audioBitrate
  };
}
