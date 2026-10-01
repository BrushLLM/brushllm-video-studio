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
  return p.mode === 'bitrate' || isGpu(codec);
}

const VIDEO_ENCODERS = {
  h264: 'libx264',
  hevc: 'libx265',
  vp9: 'libvpx-vp9',
  av1: 'libsvtav1',
  mpeg4: 'mpeg4',
  h264_videotoolbox: 'h264_videotoolbox',
  hevc_videotoolbox: 'hevc_videotoolbox',
  copy: 'copy'
};

const GPU_ENCODERS = new Set(['h264_videotoolbox', 'hevc_videotoolbox']);

// Per-codec "encode speed" mapping (replaces the x264-only preset list).
// SVT-AV1: 0 (slowest/best) .. 13 (fastest). VP9 cpu-used: 0..5 (5 fastest).
const SVT_SPEED = { slow: 4, medium: 6, fast: 8 };
const VP9_CPU = { slow: 2, medium: 4, fast: 5 };
const X264_SPEED = { slow: 'slow', medium: 'medium', fast: 'fast' };

const AUDIO_ENCODERS = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
  flac: 'flac',
  wav: 'pcm_s16le',
  vorbis: 'libvorbis',
  copy: 'copy'
};

const CONTAINERS = {
  mp4: { ext: '.mp4', f: 'mp4' },
  mkv: { ext: '.mkv', f: 'matroska' },
  webm: { ext: '.webm', f: 'webm' },
  mov: { ext: '.mov', f: 'mov' },
  avi: { ext: '.avi', f: 'avi' }
};

const AUDIO_FORMATS = {
  mp3: { ext: '.mp3', enc: 'libmp3lame' },
  m4a: { ext: '.m4a', enc: 'aac' },
  aac: { ext: '.aac', enc: 'aac' },
  flac: { ext: '.flac', enc: 'flac' },
  wav: { ext: '.wav', enc: 'pcm_s16le' },
  ogg: { ext: '.ogg', enc: 'libvorbis' },
  opus: { ext: '.opus', enc: 'libopus' }
};

// Near-transparent re-encode used by visual edit ops (crop / rotate / burn...).
const EDIT_ENCODE = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium'];

// Which source audio codecs each re-encode output container can hold.
// Mirrors COPYABLE_AUDIO in shared/resolve.mjs (consistency-tested): Opus or
// Vorbis copied into MP4 "succeeds" but plays in almost no real player.
const REENCODE_COPYABLE_AUDIO = {
  mp4: ['aac', 'mp3', 'ac3', 'eac3', 'alac'],
  mov: ['aac', 'mp3', 'ac3', 'eac3', 'alac'],
  mkv: ['aac', 'mp3', 'ac3', 'eac3', 'flac', 'opus', 'vorbis', 'alac']
};

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
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

function num(v, fallback) {
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
  const enc = VIDEO_ENCODERS[codec] || 'libx264';
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
  const args = start > 0 ? ['-ss', secToTime(start)] : [];
  if (end != null && end > start) args.push('-t', (end - start).toFixed(3));
  return args;
}

function concatListContent(paths) {
  // ffmpeg concat demuxer quoting: backslash and quote escaped with backslash.
  return paths
    .map((p) => `file '${String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
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
      const codecs = (ctx.allProbes || []).map(
        (x) => `${x.video ? x.video.codec : '-'}|${x.audio ? x.audio.codec : '-'}`
      );
      const same = codecs.every((c) => c === codecs[0]);
      mode = same ? 'copy' : 'reencode';
    }
    const args = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt'];
    if (mode === 'copy') {
      args.push('-map', '0', '-c', 'copy', ...containerExtras(container, null));
    } else {
      args.push(
        ...videoEncodeArgs(p.videoCodec || 'h264', {
          crf: p.crf,
          bitrate: useBitrate(p.videoCodec || 'h264', p) ? p.videoBitrate : undefined,
          encodeSpeed: p.encodeSpeed
        }),
        ...audioEncodeArgs(p.audioCodec || 'aac', p.audioBitrate || 160),
        ...containerExtras(container, p.videoCodec || 'h264')
      );
    }
    args.push(...PROGRESS_ARGS, out);
    return {
      steps: [{ args, label: 'merge' }],
      auxFiles: [{ name: 'concat.txt', content: concatListContent(inputs) }]
    };
  },

  'video.trim'(p, inputs, out, ctx) {
    const pre = trimArgs(p);
    if (!p.precise) {
      const args = [
        '-hide_banner', '-y', ...pre, '-i', inputs[0],
        '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        ...PROGRESS_ARGS, out
      ];
      return { steps: [{ args, label: 'trim' }] };
    }
    const args = [
      '-hide_banner', '-y', ...pre, '-i', inputs[0],
      ...EDIT_ENCODE, ...reencodeAudioArgs(out, ctx),
      ...containerExtras(containerOf(out), 'h264'),
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
        '-hide_banner', '-y', ...pre, '-i', inputs[0],
        '-vf', scale,
        '-c:v', 'libwebp_anim', '-quality', String(num(p.quality, 75)),
        '-loop', num(p.loop, 0), '-an',
        ...PROGRESS_ARGS, out
      ];
      return { steps: [{ args, label: 'webp' }] };
    }
    // GIF: two-pass palette approach for much better quality.
    const pass1 = [
      '-hide_banner', '-y', ...pre, '-i', inputs[0],
      '-vf', `${scale},palettegen=max_colors=${num(p.colors, 128)}`,
      '-an', ...PROGRESS_ARGS, 'palette.png'
    ];
    const pass2 = [
      '-hide_banner', '-y', ...pre, '-i', inputs[0], '-i', 'palette.png',
      '-filter_complex',
      `[0:v]${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4`,
      '-an', ...PROGRESS_ARGS, out
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
      ...containerExtras(container, (ctx.probe && ctx.probe.video && ctx.probe.video.codec)),
      ...PROGRESS_ARGS, out
    ];
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
      '-hide_banner', '-y', ...pre, '-i', inputs[0],
      '-c:a', 'copy', ...PROGRESS_ARGS, out
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
