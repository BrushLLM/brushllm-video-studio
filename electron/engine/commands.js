// Pure command builders: (op, params, inputs, outputPath, ctx) -> { steps, auxFiles } | null
//
// Every step is one ffmpeg invocation: { args: [...], label: string }.
// The runner executes steps sequentially with cwd = job temp dir, so bare
// filenames (palette.png, concat.txt, sub.srt) resolve to temp files and
// sidestep ffmpeg filter-path escaping entirely.
//
// ctx = { hasAudio, hasVideo, probe, allProbes, subFormats: ['srt','ass'] }
//
// Returns null for operations that need no ffmpeg run (metadata view,
// JS-side subtitle transforms).
//
// Bitrates are always kbps NUMBERS in params; converted to "<n>k" here.
// CRF-mode correctness: a target bitrate is only meaningful in bitrate mode
// or on GPU encoders (VideoToolbox has no CRF) — see shared/resolve.mjs.

function useBitrate(codec, p) {
  return (p.rateControl || p.mode) === 'bitrate' || isGpu(codec);
}

const contract = require('../../shared/media-contract.json');
const { mergeCopyCompatibility } = require('../../shared/media.cjs');
const VIDEO_ENCODERS = contract.videoEncoders;
const GPU_ENCODERS = new Set(contract.gpuEncoders);

// Per-codec "encode speed" mapping (replaces the x264-only preset list).
// SVT-AV1: 0 (slowest/best) .. 13 (fastest). VP9 cpu-used: 0..5 (5 fastest).
const SVT_SPEED = { slow: 4, medium: 6, fast: 8 };
const VP9_CPU = { slow: 2, medium: 4, fast: 5 };
const X264_SPEED = { slow: 'slow', medium: 'medium', fast: 'fast' };

const AUDIO_ENCODERS = contract.audioEncoders;
const CONTAINERS = contract.containers;
const AUDIO_FORMATS = contract.audioFormats;

// Near-transparent re-encode used by visual edit ops (crop / rotate / burn...).
const EDIT_ENCODE = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium'];

// Which source audio codecs each re-encode output container can hold.
// Mirrors COPYABLE_AUDIO in shared/resolve.mjs (consistency-tested): Opus or
// Vorbis copied into MP4 "succeeds" but plays in almost no real player.
const REENCODE_COPYABLE_AUDIO = contract.copyableAudio;

// Audio args for re-encoding ops: copy only when the output container can
// actually hold the source codec, otherwise re-encode to AAC.
function reencodeAudioArgs(out, ctx) {
  const container = containerOf(out);
  const srcAudio = ctx && ctx.probe && ctx.probe.audio && ctx.probe.audio.codec;
  const copyable = (REENCODE_COPYABLE_AUDIO[container] || []).includes(srcAudio);
  if (copyable) return ['-c:a', 'copy'];
  return ['-c:a', 'aac', '-b:a', '160k'];
}

const PROGRESS_ARGS = ['-progress', 'pipe:1', '-nostats'];

function secToTime(s) {
  if (s == null || !isFinite(s) || s < 0) s = 0;
  const ms = Math.round(Number(s) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = (ms % 60000) / 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

function num(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function isGpu(codec) {
  return GPU_ENCODERS.has(codec);
}

// q: { crf, bitrate (kbps), encodeSpeed }
function videoEncodeArgs(codec, q) {
  codec = codec || 'h264';
  if (codec === 'copy') return ['-c:v', 'copy'];
  const enc = VIDEO_ENCODERS[codec];
  if (!enc) throw new Error(`Unsupported video encoder: ${codec}`);
  const args = ['-c:v', enc];
  const speed = (q && q.encodeSpeed) || 'medium';
  const bitrateK = q && Number(q.bitrate);

  if (isGpu(codec)) {
    // VideoToolbox has no CRF; quality is bitrate-driven (UI enforces this).
    if (bitrateK > 0) args.push('-b:v', `${Math.round(bitrateK)}k`);
    else args.push('-q:v', '50');
    return args;
  }

  if (codec === 'av1') {
    args.push('-preset', String(SVT_SPEED[speed] ?? 6));
    if (bitrateK > 0) args.push('-b:v', `${Math.round(bitrateK)}k`);
    else args.push('-crf', String(num(q && q.crf, 30)));
    return args;
  }

  if (codec === 'vp9') {
    args.push('-deadline', 'good', '-cpu-used', String(VP9_CPU[speed] ?? 4));
    if (bitrateK > 0) {
      args.push('-b:v', `${Math.round(bitrateK)}k`, '-maxrate', `${Math.round(bitrateK)}k`, '-bufsize', `${Math.round(bitrateK * 2)}k`);
    } else {
      args.push('-crf', String(num(q && q.crf, 30)), '-b:v', '0');
    }
    return args;
  }

  // libx264 / libx265 / mpeg4
  if (bitrateK > 0) {
    args.push('-b:v', `${Math.round(bitrateK)}k`);
  } else {
    args.push('-crf', String(num(q && q.crf, 20)));
  }
  if (codec !== 'mpeg4') args.push('-preset', X264_SPEED[speed] || 'medium');
  return args;
}

function audioEncodeArgs(codec, bitrateK) {
  if (codec === 'copy') return ['-c:a', 'copy'];
  const enc = AUDIO_ENCODERS[codec] || 'aac';
  const args = ['-c:a', enc];
  const k = Number(bitrateK);
  if (k > 0 && !['flac', 'wav'].includes(codec)) args.push('-b:a', `${Math.round(k)}k`);
  return args;
}

function containerExtras(container, videoCodec) {
  const ex = [];
  if (container === 'mp4' || container === 'mov') {
    ex.push('-movflags', '+faststart');
    if (videoCodec === 'hevc' || videoCodec === 'hevc_videotoolbox') ex.push('-tag:v', 'hvc1');
  }
  return ex;
}

// atempo only accepts 0.5–2, chain it for wider ranges.
function atempoChain(factor) {
  const parts = [];
  let f = factor;
  while (f > 2.0001) {
    parts.push('atempo=2.0000');
    f /= 2;
  }
  while (f < 0.4999) {
    parts.push('atempo=0.5000');
    f *= 2;
  }
  parts.push(`atempo=${f.toFixed(4)}`);
  return parts.join(',');
}

function trimArgs(params) {
  const start = num(params.startSec, 0);
  const end = params.endSec != null && params.endSec !== '' ? num(params.endSec, 0) : null;
  // -ss stays input-side (fast seek); the duration cap is output-side so the
  // muxed file can never exceed the requested range through packet preroll.
  const inputArgs = start > 0 ? ['-ss', secToTime(start)] : [];
  const duration = end != null && end > start ? (end - start).toFixed(3) : null;
  return { inputArgs, outputArgs: duration ? ['-t', duration] : [] };
}

function concatListContent(paths) {
  // ffmpeg concat demuxer quoting: inside single quotes, a single quote must
  // be closed, escaped, and reopened ('\''); backslashes outside quotes are
  // literal. Escaping backslashes INSIDE the quoted span is wrong — ffmpeg
  // then looks for a doubled backslash in the actual filename.
  return paths
    .map((p) => `file '${String(p).replace(/'/g, "'\\''")}'`)
    .join('\n') + '\n';
}

// ---------------------------------------------------------------- builders

const builders = {
  // ---- VIDEO ----------------------------------------------------------

  'video.convert'(p, inputs, out, ctx) {
    const container = p.container || 'mp4';
    let vCodec = p.videoCodec || 'h264';
    let aCodec = p.audioCodec || 'aac';
    if (aCodec === 'auto') {
      // Defense only — production resolves 'auto' in main.js via resolve.mjs.
      aCodec = { webm: 'opus', avi: 'mp3' }[container] || 'aac';
    }
    if (container === 'webm') {
      vCodec = 'vp9';
      const srcAudio = ctx && ctx.probe && ctx.probe.audio && ctx.probe.audio.codec;
      aCodec = aCodec === 'copy' && ['opus', 'vorbis'].includes(srcAudio) ? 'copy' : 'opus';
    }
    if (container === 'avi') {
      if (['h264', 'hevc', 'av1', 'h264_videotoolbox', 'hevc_videotoolbox'].includes(vCodec)) vCodec = 'mpeg4';
      if (aCodec === 'copy' || aCodec === 'opus') aCodec = 'mp3';
    }
    const args = [
      '-hide_banner', '-y',
      '-i', inputs[0],
      ...videoEncodeArgs(vCodec, {
        crf: p.crf,
        bitrate: useBitrate(vCodec, p) ? p.videoBitrate : undefined,
        encodeSpeed: p.encodeSpeed
      }),
      ...audioEncodeArgs(aCodec, p.audioBitrate || 160),
      ...containerExtras(container, vCodec),
      ...PROGRESS_ARGS,
      out
    ];
    return { steps: [{ args, label: 'convert' }] };
  },

  'video.compress'(p, inputs, out, ctx) {
    // p.videoCodec is authoritative: main.js resolved it through
    // shared/resolve.mjs (quality preset + GPU strategy) before the job
    // entered the queue. Only fall back to the source codec family when a
    // caller bypassed resolution (tests / direct queue use).
    const src = (ctx.probe && ctx.probe.video && ctx.probe.video.codec) || 'h264';
    const sourceFamily = ['h264', 'hevc', 'vp9', 'av1'].includes(src) ? src : 'h264';
    const codec = p.videoCodec && (VIDEO_ENCODERS[p.videoCodec] || GPU_ENCODERS.has(p.videoCodec))
      ? p.videoCodec
      : sourceFamily;
    const args = [
      '-hide_banner', '-y',
      '-i', inputs[0],
      ...videoEncodeArgs(codec, {
        crf: p.crf,
        bitrate: useBitrate(codec, p) ? p.videoBitrate : undefined,
        encodeSpeed: p.encodeSpeed
      }),
      ...audioEncodeArgs(p.audioCodec || 'aac', p.audioBitrate || 128),
      ...containerExtras(containerOf(out), codec),
      ...PROGRESS_ARGS,
      out
    ];
    return { steps: [{ args, label: 'compress' }] };
  },

  'video.merge'(p, inputs, out, ctx) {
    const container = p.container === 'source' ? containerOf(inputs[0]) : p.container || 'mp4';
    let mode = p.mode || 'auto';
    if (mode === 'auto') {
      const compatibility = mergeCopyCompatibility(ctx.allProbes || []);
      mode = compatibility.compatible ? 'copy' : 'reencode';
    }
    if (mode === 'copy') {
      // Strict copy: only when every stream parameter matches. Incomplete
      // metadata (e.g. unit-test stubs without full probes) is rejected so a
      // silent timeline corruption can never pass as "copy".
      const compatibility = mergeCopyCompatibility(ctx.allProbes || []);
      if (!compatibility.compatible) throw new Error(compatibility.reason);
      const args = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-map', '0', '-c', 'copy', ...containerExtras(container, null),
        ...PROGRESS_ARGS, out];
      return {
        steps: [{ args, label: 'merge' }],
        auxFiles: [{ name: 'concat.txt', content: concatListContent(inputs) }]
      };
    }
    // Re-encode merge: decode every input separately and normalize video
    // (size/SAR/fps) plus audio (rate/channels/layout) through the concat
    // filter, so mixed codecs, differing time bases and missing audio tracks
    // cannot silently drop later segments.
    const probes = (ctx.allProbes || []);
    const firstVideo = probes.map((x) => x && x.video).find(Boolean) || {};
    const targetW = Math.max(2, 2 * Math.round((firstVideo.width || 640) / 2));
    const targetH = Math.max(2, 2 * Math.round((firstVideo.height || 360) / 2));
    const targetFps = firstVideo.fps && firstVideo.fps >= 1 ? Math.min(60, Math.round(firstVideo.fps * 100) / 100) : 30;
    const firstAudio = probes.map((x) => x && x.audio).find(Boolean) || null;
    const audioRate = firstAudio && firstAudio.sampleRate ? firstAudio.sampleRate : 48000;
    const audioChannels = firstAudio && firstAudio.channels ? Math.min(2, firstAudio.channels) : 2;
    const videoLabels = [];
    const audioLabels = [];
    const inputArgs = [];
    inputs.forEach((input, i) => {
      inputArgs.push('-i', input);
      const hasAudio = Boolean(probes[i] && probes[i].audio);
      videoLabels.push(`[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${targetFps}[v${i}]`);
      audioLabels.push(hasAudio
        ? `[${i}:a]aresample=${audioRate}:first_pts=0,aformat=channel_layouts=stereo[a${i}]`
        : `anullsrc=channel_layout=stereo:sample_rate=${audioRate}:duration=${Math.max(0.1, Number((probes[i] && probes[i].durationSec) || 0)).toFixed(3)}[a${i}]`);
    });
    const filter = [
      ...videoLabels,
      ...audioLabels,
      `${videoLabels.map((_, i) => `[v${i}]`).join('')}concat=n=${inputs.length}:v=1:a=0[vout]`,
      `${audioLabels.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1[aout]`
    ].join(';');
    const args = [
      '-hide_banner', '-y', ...inputArgs,
      '-filter_complex', filter,
      '-map', '[vout]', '-map', '[aout]',
      ...videoEncodeArgs(p.videoCodec || 'h264', {
        crf: p.crf,
        bitrate: useBitrate(p.videoCodec || 'h264', p) ? p.videoBitrate : undefined,
        encodeSpeed: p.encodeSpeed
      }),
      // 1s keyframes so downstream lossless trims land predictably.
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      ...audioEncodeArgs(p.audioCodec || 'aac', p.audioBitrate || 160),
      ...containerExtras(container, p.videoCodec || 'h264'),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'merge' }] };
  },

  'video.trim'(p, inputs, out, ctx) {
    const pre = trimArgs(p);
    // The duration cap goes on the OUTPUT side: an input-side -t limits only
    // demuxed packets, and audio preroll can still push the muxed duration
    // past the requested range.
    if (!p.precise) {
      const args = [
        '-hide_banner', '-y', ...pre.inputArgs, '-i', inputs[0],
        '-map', '0', '-c', 'copy',
        // NB: avoid_negative_ts=make_zero mutates timestamps during muxing and
        // breaks the output -t cap with stream copy (measured: a 4s request
        // produced 5.27s). Input -ss already yields non-negative timestamps.
        ...pre.outputArgs,
        ...PROGRESS_ARGS, out
      ];
      return { steps: [{ args, label: 'trim' }] };
    }
    const args = [
      '-hide_banner', '-y', ...pre.inputArgs, '-i', inputs[0],
      ...EDIT_ENCODE, ...reencodeAudioArgs(out, ctx),
      ...containerExtras(containerOf(out), 'h264'),
      ...pre.outputArgs,
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'trim' }] };
  },

  'video.crop'(p, inputs, out, ctx) {
    const vf = `crop=${num(p.w, 0)}:${num(p.h, 0)}:${num(p.x, 0)}:${num(p.y, 0)}`;
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-vf', vf, ...EDIT_ENCODE, ...reencodeAudioArgs(out, ctx),
      ...containerExtras(containerOf(out), 'h264'),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'crop' }] };
  },

  'video.scale'(p, inputs, out, ctx) {
    const w = num(p.width, 0) || -2;
    const h = num(p.height, 0) || -2;
    let vf;
    if (p.mode === 'stretch') {
      vf = `scale=${w}:${h}`;
    } else {
      // Exact target size, aspect preserved, letterboxed if needed.
      vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
    }
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-vf', vf, ...EDIT_ENCODE, ...reencodeAudioArgs(out, ctx),
      ...containerExtras(containerOf(out), 'h264'),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'scale' }] };
  },

  'video.rotate'(p, inputs, out, ctx) {
    const chain = [];
    const angle = num(p.angle, 0);
    if (angle === 90) chain.push('transpose=1');
    else if (angle === 270) chain.push('transpose=2');
    else if (angle === 180) chain.push('transpose=1,transpose=1');
    if (p.flipH) chain.push('hflip');
    if (p.flipV) chain.push('vflip');
    if (!chain.length) chain.push('null');
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-vf', chain.join(','), ...EDIT_ENCODE, ...reencodeAudioArgs(out, ctx),
      ...containerExtras(containerOf(out), 'h264'),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'rotate' }] };
  },

  'video.speed'(p, inputs, out, ctx) {
    const factor = Math.min(4, Math.max(0.25, num(p.factor, 1)));
    if (ctx.hasAudio) {
      const args = [
        '-hide_banner', '-y', '-i', inputs[0],
        '-filter_complex',
        `[0:v]setpts=PTS/${factor}[v];[0:a]${atempoChain(factor)}[a]`,
        '-map', '[v]', '-map', '[a]',
        ...EDIT_ENCODE, '-c:a', 'aac', '-b:a', '160k',
        ...containerExtras(containerOf(out), 'h264'),
        ...PROGRESS_ARGS, out
      ];
      return { steps: [{ args, label: 'speed' }] };
    }
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-vf', `setpts=PTS/${factor}`, ...EDIT_ENCODE,
      ...containerExtras(containerOf(out), 'h264'),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'speed' }] };
  },

  'video.mute'(p, inputs, out) {
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-map', '0', '-c', 'copy', '-an',
      ...containerExtras(containerOf(out), null),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'mute' }] };
  },

  'video.replaceAudio'(p, inputs, out) {
    // WebM cannot hold AAC; use Opus there so the copied video stream survives.
    const isWebm = containerOf(out) === 'webm';
    const args = [
      '-hide_banner', '-y',
      '-i', inputs[0],
      '-i', inputs[1],
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      ...(isWebm
        ? ['-c:a', 'libopus', '-b:a', `${num(p.audioBitrate, 192)}k`]
        : ['-c:a', 'aac', '-b:a', `${num(p.audioBitrate, 192)}k`]),
      '-shortest',
      ...containerExtras(containerOf(out), null),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'replace-audio' }] };
  },

  'video.extractAudio'(p, inputs, out, ctx) {
    const format = p.format || 'copy';
    let args;
    if (format === 'copy') {
      const src = (ctx.probe && ctx.probe.audio && ctx.probe.audio.codec) || '';
      const map = { aac: '.m4a', mp3: '.mp3', flac: '.flac', opus: '.opus', vorbis: '.ogg' };
      const ext = map[src] || '.mka';
      out = out.replace(/\.[^.]+$/, ext);
      args = ['-hide_banner', '-y', '-i', inputs[0], '-vn', '-c:a', 'copy'];
    } else {
      const f = AUDIO_FORMATS[format];
      out = out.replace(/\.[^.]+$/, f.ext);
      args = [
        '-hide_banner', '-y', '-i', inputs[0], '-vn',
        ...audioEncodeArgs(format, num(p.bitrate, 192))
      ];
      if (format === 'm4a') args.push('-f', 'ipod');
      if (format === 'opus') args.push('-f', 'opus');
    }
    args.push(...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'extract-audio' }], outputPath: out };
  },

  'video.extractFrames'(p, inputs, out) {
    const format = p.format === 'jpg' ? 'jpg' : 'png';
    const args = ['-hide_banner', '-y'];
    if (p.mode === 'single') {
      args.push('-ss', secToTime(num(p.timeSec, 0)), '-i', inputs[0], '-frames:v', '1');
      if (format === 'jpg') args.push('-q:v', '2');
      args.push(...PROGRESS_ARGS, `${out}.${format}`);
      return { steps: [{ args, label: 'frame' }], outputPath: `${out}.${format}` };
    }
    args.push('-i', inputs[0], '-vf', `fps=${num(p.fps, 1)}`);
    if (format === 'jpg') args.push('-q:v', '2');
    args.push(...PROGRESS_ARGS, `${out}_%05d.${format}`);
    return { steps: [{ args, label: 'frames' }], outputPath: `${out}_%05d.${format}` };
  },

  'video.anim'(p, inputs, out) {
    const fps = Math.max(1, Math.min(30, num(p.fps, 12)));
    const width = Math.max(32, num(p.width, 480));
    const pre = trimArgs({ startSec: p.startSec, endSec: p.endSec });
    const scale = `fps=${fps},scale=${width}:-1:flags=lanczos`;
    if (p.format === 'webp') {
      const args = [
        '-hide_banner', '-y', ...pre.inputArgs, '-i', inputs[0],
        '-vf', scale,
        '-c:v', 'libwebp_anim', '-quality', String(num(p.quality, 75)),
        '-loop', num(p.loop, 0), '-an',
        ...pre.outputArgs,
        ...PROGRESS_ARGS, out
      ];
      return { steps: [{ args, label: 'webp' }] };
    }
    // GIF: two-pass palette approach for much better quality.
    const pass1 = [
      '-hide_banner', '-y', ...pre.inputArgs, '-i', inputs[0],
      '-vf', `${scale},palettegen=max_colors=${num(p.colors, 128)}`,
      '-an', ...pre.outputArgs, ...PROGRESS_ARGS, 'palette.png'
    ];
    const pass2 = [
      '-hide_banner', '-y', ...pre.inputArgs, '-i', inputs[0], '-i', 'palette.png',
      '-filter_complex',
      `[0:v]${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`,
      '-an', ...pre.outputArgs, ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args: pass1, label: 'palette' }, { args: pass2, label: 'gif' }] };
  },

  'video.embedSubs'(p, inputs, out) {
    const container = p.container || 'mkv';
    const args = ['-hide_banner', '-y', '-i', inputs[0]];
    inputs.slice(1).forEach((_, i) => args.push('-i', inputs[1 + i]));
    args.push('-map', '0');
    inputs.slice(1).forEach((_, i) => args.push('-map', `${i + 1}`));
    args.push('-c', 'copy');
    if (container === 'mp4' || container === 'mov') {
      args.push('-c:s', 'mov_text');
    } else {
      args.push('-c:s', 'copy');
    }
    (p.languages || []).forEach((lang, i) => {
      if (lang) args.push(`-metadata:s:s:${i}`, `language=${lang}`);
    });
    args.push(...containerExtras(container, null), ...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'embed-subs' }] };
  },

  'video.burnSubs'(p, inputs, out, ctx) {
    // prepare.js has already placed a UTF-8 subtitle as sub0.<ext> in cwd.
    const subFile = `sub0.${ctx.subFormats[0] || 'srt'}`;
    const isAss = (ctx.subFormats[0] || 'srt') === 'ass';
    let filter = `subtitles=filename=${subFile}`;
    // UI param is `margin` (bottom margin); ffmpeg force_style uses MarginV.
    if (!isAss && (p.fontSize || p.margin != null)) {
      filter += `:force_style='FontSize=${num(p.fontSize, 24)},MarginV=${num(p.margin, 30)}'`;
    }
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-vf', filter, ...EDIT_ENCODE, ...reencodeAudioArgs(out, ctx),
      ...containerExtras(containerOf(out), 'h264'),
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'burn-subs' }] };
  },

  'video.remux'(p, inputs, out, ctx) {
    const container = p.container || 'mp4';
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-map', '0', '-c', 'copy',
      ...containerExtras(container, (ctx.probe && ctx.probe.video && ctx.probe.video.codec))
    ];
    // Cross-container subtitle remux: text subtitles must be converted for the
    // target container (subrip cannot be copied into MP4; mov_text cannot be
    // copied into MKV). Image-based subs (PGS/DVD) cannot convert — drop them
    // rather than fail the whole remux, matching "may drop incompatible tracks".
    const subCodecs = (ctx.probe && ctx.probe.subtitleStreams || []).map((s) => s.codec);
    const needsSubtitleConversion = subCodecs.some((codec) => !contract.copyableSubtitle[container].includes(codec));
    if (needsSubtitleConversion) {
      const convertible = subCodecs.every((codec) => codec === 'subrip' || codec === 'webvtt' || codec === 'ass' || codec === 'ssa' || codec === 'mov_text');
      if (convertible) {
        // Replace the blanket -c copy with per-stream encoding.
        const copyIndex = args.indexOf('-c');
        args.splice(copyIndex, 2);
        args.push('-c:v', 'copy', '-c:a', 'copy', '-c:s', container === 'mp4' || container === 'mov' ? 'mov_text' : 'srt');
      } else {
        // Image subtitles: drop subtitle streams instead of failing.
        args.push('-sn');
      }
    }
    args.push(...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'remux' }] };
  },

  'video.metadata'() {
    return null; // handled by the renderer via probe
  },

  // ---- AUDIO ------------------------------------------------------------

  'audio.convert'(p, inputs, out) {
    const format = p.format || 'mp3';
    const f = AUDIO_FORMATS[format];
    out = out.replace(/\.[^.]+$/, f.ext);
    const args = [
      '-hide_banner', '-y', '-i', inputs[0], '-vn',
      ...audioEncodeArgs(format, num(p.bitrate, 192))
    ];
    if (p.sampleRate) args.push('-ar', String(num(p.sampleRate, 44100)));
    if (p.channels) args.push('-ac', String(num(p.channels, 2)));
    if (format === 'm4a') args.push('-f', 'ipod');
    if (format === 'opus') args.push('-f', 'opus');
    args.push(...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'convert' }], outputPath: out };
  },

  'audio.compress'(p, inputs, out, ctx) {
    const src = (ctx.probe && ctx.probe.audio && ctx.probe.audio.codec) || 'mp3';
    const format = AUDIO_FORMATS[src] ? src : 'mp3';
    const f = AUDIO_FORMATS[format];
    out = out.replace(/\.[^.]+$/, f.ext);
    const args = [
      '-hide_banner', '-y', '-i', inputs[0], '-vn',
      ...audioEncodeArgs(format, num(p.bitrate, 128))
    ];
    if (format === 'm4a') args.push('-f', 'ipod');
    if (format === 'opus') args.push('-f', 'opus');
    args.push(...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'compress' }], outputPath: out };
  },

  'audio.trim'(p, inputs, out) {
    const pre = trimArgs(p);
    const args = [
      '-hide_banner', '-y', ...pre.inputArgs, '-i', inputs[0],
      '-c:a', 'copy', ...pre.outputArgs, ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'trim' }] };
  },

  'audio.volume'(p, inputs, out, ctx) {
    const src = (ctx.probe && ctx.probe.audio && ctx.probe.audio.codec) || 'mp3';
    const format = AUDIO_FORMATS[src] ? src : 'mp3';
    const f = AUDIO_FORMATS[format];
    out = out.replace(/\.[^.]+$/, f.ext);
    const args = [
      '-hide_banner', '-y', '-i', inputs[0], '-vn',
      '-af', `volume=${num(p.db, 0)}dB`,
      ...audioEncodeArgs(format, num(p.bitrate, 192))
    ];
    if (format === 'm4a') args.push('-f', 'ipod');
    if (format === 'opus') args.push('-f', 'opus');
    args.push(...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'volume' }], outputPath: out };
  },

  'audio.loudnorm'(p, inputs, out, ctx) {
    const src = (ctx.probe && ctx.probe.audio && ctx.probe.audio.codec) || 'mp3';
    const format = AUDIO_FORMATS[src] ? src : 'mp3';
    const f = AUDIO_FORMATS[format];
    out = out.replace(/\.[^.]+$/, f.ext);
    const args = [
      '-hide_banner', '-y', '-i', inputs[0], '-vn',
      '-af', `loudnorm=I=${num(p.target, -16)}:TP=${num(p.tp, -1.5)}:LRA=${num(p.lra, 11)}`,
      ...audioEncodeArgs(format, num(p.bitrate, 192))
    ];
    if (format === 'm4a') args.push('-f', 'ipod');
    if (format === 'opus') args.push('-f', 'opus');
    args.push(...PROGRESS_ARGS, out);
    return { steps: [{ args, label: 'loudnorm' }], outputPath: out };
  },

  'subtitle.extract'(p, inputs, out) {
    const format = p.format || 'srt';
    const encMap = { srt: 'subrip', vtt: 'webvtt', ass: 'ass' };
    out = out.replace(/\.[^.]+$/, `.${format}`);
    const args = [
      '-hide_banner', '-y', '-i', inputs[0],
      '-map', `0:s:${num(p.streamIndex, 0)}`,
      '-c:s', encMap[format],
      ...PROGRESS_ARGS, out
    ];
    return { steps: [{ args, label: 'extract-subs' }], outputPath: out };
  }
};

function containerOf(filePath) {
  const ext = (filePath.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  const map = { mp4: 'mp4', m4v: 'mp4', mkv: 'mkv', webm: 'webm', mov: 'mov', avi: 'avi' };
  return map[ext] || 'mp4';
}

// Maximum threading for EVERY ffmpeg invocation — always on.
// Applied here — the single choke point all operations pass through — so
// every current and future op gets it without touching individual builders.
//
//   - `-filter_threads 0 -filter_complex_threads 0`  filter graphs (global)
//   - `-threads 0` before each `-i`                  decoder (all cores)
//   - `-threads 0` in the output section             encoder (all cores;
//                                                    VP9 is single-threaded
//                                                    by default — the big win)
// `0` = ffmpeg auto-sizes to the CPU count. Quality settings are untouched.
// VP9 extra: libvpx ignores plain -threads for encode parallelism —
// `-row-mt 1 -tile-columns 2` is what actually parallelizes it
// (measured ~1.9x on 1080p; tiles clamp harmlessly on small resolutions).
function injectThreading(args, videoWidth = 0) {
  const out = ['-filter_threads', '0', '-filter_complex_threads', '0'];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i') {
      out.push('-threads', '0');
    }
    out.push(args[i]);
  }
  // The last argument is always the output path.
  if (out.length > 2) {
    out.splice(out.length - 1, 0, '-threads', '0');
    const isVp9 = args.some((a, i) => a === '-c:v' && args[i + 1] === 'libvpx-vp9');
    if (isVp9) {
      // Tiles scale with resolution: 4 tiles for ≤2K, 8 for ≥2.5K (libvpx
      // clamps to the 256px minimum tile width, so this stays legal).
      const tiles = videoWidth >= 2560 ? 3 : 2;
      out.splice(out.length - 1, 0, '-row-mt', '1', '-tile-columns', String(tiles));
    }
  }
  return out;
}

function buildJobCommands(op, params, inputs, outputPath, ctx) {
  const builder = builders[op];
  if (!builder) throw new Error(`Unknown op: ${op}`);
  const result = builder(params || {}, inputs, outputPath, ctx || {});
  if (result) {
    result.op = op;
    const videoWidth = ctx && ctx.probe && ctx.probe.video ? ctx.probe.video.width : 0;
    for (const step of result.steps) {
      // Threading optimizations are always on — x264 is auto-threaded anyway,
      // and the VP9/decoder/filter knobs are pure wins with no quality cost.
      step.args = injectThreading(step.args, videoWidth);
      step.commandText = step.args.join(' ');
    }
  }
  return result;
}

// Which output extension an op produces (before the runner resolves collisions).
// Re-encoding ops (libx264 + aac/copy) cannot land in WebM/AVI — those inputs
// get an MP4 output instead of inheriting the source extension.
const REENCODE_OPS = new Set(['video.crop', 'video.scale', 'video.rotate', 'video.speed', 'video.burnSubs', 'video.replaceAudio']);

function outputExtFor(op, params, inputPath, ctx) {
  const inputExt = (inputPath.match(/\.([^.]+)$/) || [])[1] || 'mp4';
  switch (op) {
    case 'video.convert':
    case 'video.merge':
    case 'video.embedSubs':
    case 'video.remux':
      return CONTAINERS[params.container] ? CONTAINERS[params.container].ext : `.${inputExt}`;
    case 'video.anim':
      return params.format === 'webp' ? '.webp' : '.gif';
    case 'video.extractAudio':
      if (params.format === 'copy') {
        const src = (ctx && ctx.probe && ctx.probe.audio && ctx.probe.audio.codec) || '';
        return { aac: '.m4a', mp3: '.mp3', flac: '.flac', opus: '.opus', vorbis: '.ogg' }[src] || '.mka';
      }
      return (AUDIO_FORMATS[params.format] || { ext: '.mp3' }).ext;
    case 'audio.convert':
      return (AUDIO_FORMATS[params.format] || { ext: '.mp3' }).ext;
    case 'subtitle.extract':
      return `.${params.format || 'srt'}`;
    default: {
      const reencoding = REENCODE_OPS.has(op) || (op === 'video.trim' && params.precise);
      if (reencoding && !['mp4', 'mkv', 'mov'].includes(containerOf(inputPath))) {
        return '.mp4';
      }
      return `.${inputExt}`;
    }
  }
}

module.exports = {
  injectThreading,
  REENCODE_COPYABLE_AUDIO,
  buildJobCommands,
  outputExtFor,
  secToTime,
  atempoChain,
  concatListContent,
  videoEncodeArgs,
  audioEncodeArgs,
  VIDEO_ENCODERS,
  GPU_ENCODERS,
  SVT_SPEED,
  VP9_CPU,
  AUDIO_ENCODERS,
  CONTAINERS,
  AUDIO_FORMATS
};
