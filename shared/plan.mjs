// Three-layer media summary: source (probed input) -> plan (what the job
// will produce) -> actual (probed output). Shared by renderer, main and tests.
//
// sizeEstimate semantics:
//   number  -> estimated bytes
//   'source' -> close to source size (stream copy)
//   null    -> cannot be reliably estimated (CRF mode)

import { resolveEncoding } from './resolve.mjs';

const VIDEO_CODEC_LABELS = {
  h264: 'H.264',
  hevc: 'H.265 (HEVC)',
  vp9: 'VP9',
  av1: 'AV1',
  mpeg4: 'MPEG-4',
  h264_videotoolbox: 'H.264 (GPU)',
  hevc_videotoolbox: 'H.265 (GPU)',
  theora: 'Theora',
  prores: 'ProRes',
  vp8: 'VP8'
};

const AUDIO_CODEC_LABELS = {
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  pcm_s16le: 'PCM',
  vorbis: 'Vorbis',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  alac: 'ALAC'
};

const CONTAINER_LABELS = { mp4: 'MP4', mkv: 'MKV', webm: 'WebM', mov: 'MOV', avi: 'AVI' };

function videoLabel(codec) {
  return VIDEO_CODEC_LABELS[codec] || (codec ? codec.toUpperCase() : null);
}

function audioLabel(codec) {
  return AUDIO_CODEC_LABELS[codec] || (codec ? codec.toUpperCase() : null);
}

function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// Estimate output bytes from kbps bitrates and duration (+5% container overhead).
function estimateFromBitrate(videoKbps, audioKbps, durationSec) {
  if (!(durationSec > 0)) return null;
  const kbps = num(videoKbps, 0) + num(audioKbps, 0);
  if (!(kbps > 0)) return null;
  return Math.round((kbps * 1000 * durationSec / 8) * 1.05);
}

function sourceVideo(source) {
  return source && source.video ? source.video : null;
}

// op, params, source (probe summary), opts: { allProbes, gpuEncoders }
function buildPlan(op, params, source, opts = {}) {
  const p = params || {};
  const src = source || {};
  const v = sourceVideo(src);
  const a = src.audio || null;
  const dur = num(src.durationSec, 0);
  const srcSize = num(src.size, 0);
  const plan = {
    op,
    containerLabel: null,
    videoEncoderLabel: null,
    qualityLabel: null,
    audioEncoderLabel: null,
    audioCopy: false,
    hw: false,
    cpuNote: false,
    width: v ? v.width : null,
    height: v ? v.height : null,
    fps: v ? v.fps : null,
    durationSec: dur || null,
    sizeEstimate: null,
    sizeNoteKey: null // i18n key explaining the estimate
  };

  const bitrateMode = p.mode === 'bitrate' && num(p.videoBitrate, 0) > 0;

  switch (op) {
    case 'video.convert':
    case 'video.compress': {
      // The SAME resolver that main.js applies before the job runs, so the
      // plan can never disagree with the actual ffmpeg command.
      const r = resolveEncoding(op, p, src, { gpuEncoders: opts.gpuEncoders || [] });
      if (r.error) return { ...plan, error: r.error };
      plan.hw = r.hw;
      plan.cpuNote = r.cpuNote;
      plan.audioCopy = r.audioCopy;
      plan.containerLabel = CONTAINER_LABELS[r.container] || r.container.toUpperCase();
      plan.videoEncoderLabel = videoLabel(r.videoCodec);
      plan.audioEncoderLabel = r.audioCodec === 'copy'
        ? (audioLabel(a && a.codec) || '—')
        : audioLabel(r.audioCodec);
      if (r.mode === 'bitrate' && r.videoBitrate > 0) {
        plan.qualityLabel = `${r.videoBitrate} kbps`;
        const audioK = r.audioCopy ? 0 : num(r.audioBitrate, 128);
        plan.sizeEstimate = estimateFromBitrate(r.videoBitrate, audioK, dur);
      } else {
        plan.qualityLabel = `CRF ${num(r.crf, op === 'video.compress' ? 26 : 20)}`;
        plan.sizeNoteKey = 'plan.sizeCRF';
      }
      return plan;
    }

    case 'video.merge': {
      const container = p.container === 'source' ? containerOfSource(src) : p.container || 'mp4';
      plan.containerLabel = CONTAINER_LABELS[container] || 'MP4';
      let mode = p.mode || 'auto';
      if (mode === 'auto') {
        const codecs = (opts.allProbes || []).map(
          (x) => `${x.video ? x.video.codec : '-'}|${x.audio ? x.audio.codec : '-'}`
        );
        mode = codecs.length && codecs.every((c) => c === codecs[0]) ? 'copy' : 'reencode';
      }
      const totalDur = (opts.allProbes || []).length
        ? opts.allProbes.reduce((acc, x) => acc + ((x && x.durationSec) || 0), 0)
        : dur;
      plan.durationSec = totalDur || null;
      if (mode === 'copy') {
        plan.videoEncoderLabel = videoLabel(v && v.codec);
        plan.audioEncoderLabel = audioLabel(a && a.codec);
        plan.qualityLabel = 'stream copy';
        const totalSize = (opts.allProbes || []).length
          ? opts.allProbes.reduce((acc, x) => acc + ((x && x.size) || 0), 0)
          : srcSize;
        plan.sizeEstimate = totalSize > 0 ? totalSize : 'source';
        if (plan.sizeEstimate === 'source') plan.sizeNoteKey = 'plan.sizeSource';
      } else {
        plan.videoEncoderLabel = videoLabel(p.videoCodec || 'h264');
        plan.audioEncoderLabel = 'AAC';
        plan.qualityLabel = bitrateMode ? `${Math.round(num(p.videoBitrate, 0))} kbps` : `CRF ${num(p.crf, 20)}`;
        plan.sizeEstimate = bitrateMode
          ? estimateFromBitrate(num(p.videoBitrate, 0), num(p.audioBitrate, 160), totalDur)
          : null;
        if (!plan.sizeEstimate) plan.sizeNoteKey = 'plan.sizeCRF';
      }
      return plan;
    }

    case 'video.trim': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = videoLabel(v && v.codec);
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      const start = num(p.startSec, 0);
      const end = p.endSec != null && p.endSec !== '' ? num(p.endSec, 0) : dur;
      const outDur = Math.max(0, Math.min(end, dur || end) - start);
      plan.durationSec = outDur || null;
      if (p.precise) {
        plan.videoEncoderLabel = 'H.264';
        plan.qualityLabel = 'CRF 18';
        plan.sizeEstimate = null;
        plan.sizeNoteKey = 'plan.sizeCRF';
      } else {
        plan.qualityLabel = 'stream copy';
        // Lossless trim keeps roughly the proportional share of the file.
        plan.sizeEstimate = dur > 0 && srcSize > 0 ? Math.round(srcSize * (outDur / dur)) : 'source';
        if (plan.sizeEstimate === 'source') plan.sizeNoteKey = 'plan.sizeSource';
      }
      return plan;
    }

    case 'video.crop': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = 'H.264';
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.qualityLabel = 'CRF 18';
      if (num(p.w, 0) > 0 && num(p.h, 0) > 0) {
        plan.width = num(p.w, 0);
        plan.height = num(p.h, 0);
      }
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeCRF';
      return plan;
    }

    case 'video.scale': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = 'H.264';
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.qualityLabel = 'CRF 18';
      const sizes = { '1080p': [1920, 1080], '720p': [1280, 720], '480p': [854, 480], '360p': [640, 360] };
      if (p.size && sizes[p.size]) {
        plan.width = sizes[p.size][0];
        plan.height = sizes[p.size][1];
      } else if (num(p.width, 0) > 0 && num(p.height, 0) > 0) {
        plan.width = num(p.width, 0);
        plan.height = num(p.height, 0);
      }
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeCRF';
      return plan;
    }

    case 'video.rotate': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = 'H.264';
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.qualityLabel = 'CRF 18';
      const angle = num(p.angle, 0);
      if ((angle === 90 || angle === 270) && v) {
        plan.width = v.height;
        plan.height = v.width;
      }
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeCRF';
      return plan;
    }

    case 'video.speed': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = 'H.264';
      plan.audioEncoderLabel = 'AAC';
      plan.qualityLabel = 'CRF 18';
      const factor = Math.min(4, Math.max(0.25, num(p.factor, 1)));
      if (dur > 0) plan.durationSec = dur / factor;
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeCRF';
      return plan;
    }

    case 'video.mute': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = videoLabel(v && v.codec);
      plan.qualityLabel = 'stream copy';
      plan.sizeEstimate = 'source';
      plan.sizeNoteKey = 'plan.sizeSource';
      return plan;
    }

    case 'video.replaceAudio': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = videoLabel(v && v.codec);
      plan.qualityLabel = 'stream copy';
      plan.audioEncoderLabel = 'AAC';
      plan.sizeEstimate = srcSize > 0 ? Math.round(srcSize * 0.92 + num(p.audioBitrate, 192) * 1000 * dur / 8) : 'source';
      if (plan.sizeEstimate === 'source') plan.sizeNoteKey = 'plan.sizeSource';
      return plan;
    }

    case 'video.extractAudio': {
      const format = p.format || 'copy';
      if (format === 'copy') {
        plan.containerLabel = 'MKA';
        plan.audioEncoderLabel = audioLabel(a && a.codec);
        plan.qualityLabel = 'stream copy';
        plan.sizeEstimate = 'source';
        plan.sizeNoteKey = 'plan.sizeSource';
      } else {
        const exts = { mp3: 'MP3', m4a: 'M4A', flac: 'FLAC', wav: 'WAV', ogg: 'OGG', opus: 'Opus' };
        plan.containerLabel = exts[format] || format.toUpperCase();
        plan.audioEncoderLabel = exts[format] || format.toUpperCase();
        plan.qualityLabel = `${Math.round(num(p.bitrate, 192))} kbps`;
        plan.sizeEstimate = estimateFromBitrate(0, num(p.bitrate, 192), dur);
      }
      plan.videoEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      return plan;
    }

    case 'video.extractFrames': {
      const format = p.format === 'jpg' ? 'JPG' : 'PNG';
      plan.containerLabel = format;
      plan.videoEncoderLabel = format;
      plan.qualityLabel = null;
      plan.audioEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeFrames';
      return plan;
    }

    case 'video.anim': {
      plan.containerLabel = p.format === 'webp' ? 'WebP' : 'GIF';
      plan.videoEncoderLabel = p.format === 'webp' ? 'WebP' : 'GIF (palette)';
      plan.audioEncoderLabel = null;
      plan.width = num(p.width, 480);
      plan.height = null;
      plan.fps = num(p.fps, 12);
      const start = num(p.startSec, 0);
      const end = p.endSec != null && p.endSec !== '' ? num(p.endSec, 0) : dur;
      plan.durationSec = Math.max(0, Math.min(end, dur || end) - start) || null;
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeCRF';
      return plan;
    }

    case 'video.embedSubs': {
      const container = p.container || 'mkv';
      plan.containerLabel = CONTAINER_LABELS[container] || 'MKV';
      plan.videoEncoderLabel = videoLabel(v && v.codec);
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.qualityLabel = 'stream copy';
      plan.sizeEstimate = 'source';
      plan.sizeNoteKey = 'plan.sizeSource';
      return plan;
    }

    case 'video.burnSubs': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || null;
      plan.videoEncoderLabel = 'H.264';
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.qualityLabel = 'CRF 18';
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeCRF';
      return plan;
    }

    case 'video.remux': {
      const container = p.container || 'mp4';
      plan.containerLabel = CONTAINER_LABELS[container] || 'MP4';
      plan.videoEncoderLabel = videoLabel(v && v.codec);
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.qualityLabel = 'stream copy';
      plan.sizeEstimate = 'source';
      plan.sizeNoteKey = 'plan.sizeSource';
      return plan;
    }

    case 'audio.convert': {
      const exts = { mp3: 'MP3', m4a: 'M4A', flac: 'FLAC', wav: 'WAV', ogg: 'OGG', opus: 'Opus' };
      plan.containerLabel = exts[p.format || 'mp3'] || 'MP3';
      plan.audioEncoderLabel = plan.containerLabel;
      plan.videoEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      if (['flac', 'wav'].includes(p.format)) {
        plan.qualityLabel = 'lossless';
        plan.sizeEstimate = null;
        plan.sizeNoteKey = 'plan.sizeCRF';
      } else {
        plan.qualityLabel = `${Math.round(num(p.bitrate, 192))} kbps`;
        plan.sizeEstimate = estimateFromBitrate(0, num(p.bitrate, 192), dur);
      }
      return plan;
    }

    case 'audio.compress': {
      const srcCodec = (a && a.codec) || 'mp3';
      const exts = { mp3: 'MP3', m4a: 'M4A', flac: 'FLAC', wav: 'WAV', ogg: 'OGG', opus: 'Opus' };
      plan.containerLabel = exts[srcCodec] || 'MP3';
      plan.audioEncoderLabel = plan.containerLabel;
      plan.videoEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      plan.qualityLabel = `${Math.round(num(p.bitrate, 128))} kbps`;
      plan.sizeEstimate = estimateFromBitrate(0, num(p.bitrate, 128), dur);
      return plan;
    }

    case 'audio.trim': {
      plan.containerLabel = CONTAINER_LABELS[containerOfSource(src)] || audioLabel(a && a.codec);
      plan.audioEncoderLabel = audioLabel(a && a.codec);
      plan.videoEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      plan.qualityLabel = 'stream copy';
      const start = num(p.startSec, 0);
      const end = p.endSec != null && p.endSec !== '' ? num(p.endSec, 0) : dur;
      const outDur = Math.max(0, Math.min(end, dur || end) - start);
      plan.durationSec = outDur || null;
      plan.sizeEstimate = dur > 0 && srcSize > 0 ? Math.round(srcSize * (outDur / dur)) : 'source';
      if (plan.sizeEstimate === 'source') plan.sizeNoteKey = 'plan.sizeSource';
      return plan;
    }

    case 'audio.volume':
    case 'audio.loudnorm': {
      const srcCodec = (a && a.codec) || 'mp3';
      const exts = { mp3: 'MP3', m4a: 'M4A', flac: 'FLAC', wav: 'WAV', ogg: 'OGG', opus: 'Opus' };
      plan.containerLabel = exts[srcCodec] || 'MP3';
      plan.audioEncoderLabel = plan.containerLabel;
      plan.videoEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      plan.qualityLabel = op === 'audio.loudnorm' ? `EBU R128 ${num(p.target, -16)} LUFS` : `${num(p.db, 0)} dB`;
      plan.sizeEstimate = estimateFromBitrate(0, num(p.bitrate, 192), dur);
      return plan;
    }

    case 'subtitle.extract': {
      plan.containerLabel = (p.format || 'srt').toUpperCase();
      plan.videoEncoderLabel = null;
      plan.audioEncoderLabel = null;
      plan.width = null;
      plan.height = null;
      plan.fps = null;
      plan.qualityLabel = null;
      plan.sizeEstimate = null;
      plan.sizeNoteKey = 'plan.sizeText';
      return plan;
    }

    default:
      return plan;
  }
}

function containerOfSource(src) {
  const name = (src && src.formatName) || '';
  // mp4 files report "mov,mp4,m4a,…" — check mp4 before mov.
  if (name.includes('webm')) return 'webm';
  if (name.includes('matroska')) return 'mkv';
  if (name.includes('avi')) return 'avi';
  if (name.includes('mp4')) return 'mp4';
  if (name.includes('mov')) return 'mov';
  return 'mp4';
}

// actual layer: normalize a probed output file into the same display shape.
function buildActual(probeSummary, outputPath) {
  const s = probeSummary || {};
  const v = s.video;
  const a = s.audio;
  let containerLabel;
  if (v) {
    containerLabel = CONTAINER_LABELS[containerOfSource(s)] || null;
  } else {
    // Audio-only output: derive the label from the file extension.
    const ext = (String(outputPath || '').match(/\.([^.]+)$/) || [])[1];
    const audioExts = { mp3: 'MP3', m4a: 'M4A', aac: 'AAC', flac: 'FLAC', wav: 'WAV', ogg: 'OGG', opus: 'Opus', mka: 'MKA' };
    containerLabel = audioExts[ext] || (ext ? ext.toUpperCase() : null);
  }
  return {
    containerLabel,
    videoEncoderLabel: v ? videoLabel(v.codec) : null,
    audioEncoderLabel: a ? audioLabel(a.codec) : null,
    width: v ? v.width : null,
    height: v ? v.height : null,
    fps: v ? v.fps : null,
    durationSec: s.durationSec || null,
    bitrate: s.bitrate || null,
    size: s.size || null
  };
}

export { buildPlan, buildActual, estimateFromBitrate, videoLabel, audioLabel, VIDEO_CODEC_LABELS, AUDIO_CODEC_LABELS, CONTAINER_LABELS };
