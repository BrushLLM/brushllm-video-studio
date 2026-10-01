// Operation registry — the single source of truth driving the tool pages.
// Param schemas are rendered generically by ParamPanel.
//
// Field notes:
//   group      — card grouping on the page (i18n key `group.<x>`)
//   inputKind  — which files from the section list are main inputs
//   extraInput — secondary picker (audio / subtitle), shown separately
//   instant    — runs immediately via the JS subtitle engine, no queue
//   modal      — opens a modal instead of queueing

const BITRATES = ['96', '128', '160', '192', '256', '320'];

// User-facing quality presets (normal mode). engineParams resolves them.
// Balanced uses `fast` — same CRF, meaningfully quicker than medium.
const QUALITY_PRESETS = {
  compat: { videoCodec: 'h264', crf: 20, encodeSpeed: 'fast', audioBitrate: 160 },
  balanced: { videoCodec: 'h264', crf: 23, encodeSpeed: 'fast', audioBitrate: 128 },
  quality: { videoCodec: 'h264', crf: 17, encodeSpeed: 'slow', audioBitrate: 192 },
  small: { videoCodec: 'hevc', crf: 26, encodeSpeed: 'fast', audioBitrate: 96 }
};

export const OPS = [
  // ------------------------------------------------------------- video page
  {
    id: 'video.convert', section: 'video', group: 'convert', icon: 'convert', batch: true, inputKind: 'video',
    params: [
      { key: 'qualityPreset', type: 'preset', default: 'balanced' },
      { key: 'hwStrategy', type: 'segmented', options: [
        { value: 'auto', labelKey: 'hw.auto' },
        { value: 'cpu', labelKey: 'hw.cpu' },
        { value: 'gpu', labelKey: 'hw.gpu' }
      ], default: 'auto' },
      { key: 'advanced', type: 'switch', default: false, labelKey: 'param.advancedMode' },
      { key: 'container', type: 'select', options: ['mp4', 'mkv', 'webm', 'mov', 'avi'], default: 'mp4', advanced: true },
      { key: 'videoCodec', type: 'codec', default: 'h264', advanced: true },
      { key: 'mode', type: 'segmented', options: [
        { value: 'crf', labelKey: 'param.qualityMode' },
        { value: 'bitrate', labelKey: 'param.bitrateMode' }
      ], default: 'crf', advanced: true },
      { key: 'crf', type: 'slider', min: 14, max: 34, step: 1, default: 20, hint: true, advanced: true, showIf: (p) => p.mode !== 'bitrate' },
      { key: 'videoBitrate', type: 'bitrate', default: 2500, min: 100, max: 100000, advanced: true, showIf: (p) => p.mode === 'bitrate' },
      { key: 'encodeSpeed', type: 'select', options: ['slow', 'medium', 'fast'], default: 'fast', optionLabelKeys: { slow: 'param.speedSlow', medium: 'param.speedMedium', fast: 'param.speedFast' }, advanced: true },
      { key: 'audioCodec', type: 'select', options: ['auto', 'copy', 'aac', 'mp3', 'opus'], default: 'auto', optionLabelKeys: { auto: 'param.audioAuto', copy: 'param.original' }, advanced: true },
      { key: 'audioBitrate', type: 'select', options: BITRATES, default: '160', advanced: true }
    ]
  },
  {
    id: 'video.compress', section: 'video', group: 'convert', icon: 'compress', batch: true, inputKind: 'video',
    params: [
      { key: 'qualityPreset', type: 'preset', default: 'balanced' },
      { key: 'hwStrategy', type: 'segmented', options: [
        { value: 'auto', labelKey: 'hw.auto' },
        { value: 'cpu', labelKey: 'hw.cpu' },
        { value: 'gpu', labelKey: 'hw.gpu' }
      ], default: 'auto' },
      { key: 'advanced', type: 'switch', default: false, labelKey: 'param.advancedMode' },
      { key: 'mode', type: 'segmented', options: [
        { value: 'crf', labelKey: 'param.qualityMode' },
        { value: 'bitrate', labelKey: 'param.bitrateMode' }
      ], default: 'crf', advanced: true },
      { key: 'crf', type: 'slider', min: 18, max: 36, step: 1, default: 26, hint: true, advanced: true, showIf: (p) => p.mode !== 'bitrate' },
      { key: 'videoBitrate', type: 'bitrate', default: 1500, min: 100, max: 100000, advanced: true, showIf: (p) => p.mode === 'bitrate' },
      { key: 'encodeSpeed', type: 'select', options: ['slow', 'medium', 'fast'], default: 'fast', optionLabelKeys: { slow: 'param.speedSlow', medium: 'param.speedMedium', fast: 'param.speedFast' }, advanced: true },
      { key: 'audioBitrate', type: 'select', options: ['96', '128', '160', '192'], default: '128', advanced: true }
    ]
  },
  {
    id: 'video.remux', section: 'video', group: 'convert', icon: 'remux', batch: true, inputKind: 'video',
    params: [{ key: 'container', type: 'select', options: ['mp4', 'mkv', 'webm', 'mov', 'avi'], default: 'mkv' }]
  },
  {
    id: 'video.trim', section: 'video', group: 'edit', icon: 'trim', batch: true, inputKind: 'video',
    params: [
      { key: 'startSec', type: 'time', default: 0, labelKey: 'param.start' },
      { key: 'endSec', type: 'time', default: null, labelKey: 'param.end' },
      { key: 'precise', type: 'switch', default: false, labelKey: 'param.precise', hint: true }
    ]
  },
  {
    id: 'video.merge', section: 'video', group: 'edit', icon: 'merge', batch: false, minFiles: 2, reorderable: true, inputKind: 'video',
    params: [
      { key: 'mode', type: 'segmented', options: [
        { value: 'auto', labelKey: 'param.auto' },
        { value: 'copy', labelKey: 'param.copy' },
        { value: 'reencode', labelKey: 'param.reencode' }
      ], default: 'auto', hint: 'param.mergeModeHint' },
      { key: 'container', type: 'select', options: ['mp4', 'mkv'], default: 'mp4' },
      { key: 'videoCodec', type: 'codec', default: 'h264', showIf: (p) => p.mode === 'reencode' },
      { key: 'crf', type: 'slider', min: 14, max: 34, step: 1, default: 20, showIf: (p) => p.mode === 'reencode' }
    ]
  },
  {
    id: 'video.speed', section: 'video', group: 'edit', icon: 'speed', batch: true, inputKind: 'video',
    params: [{ key: 'factor', type: 'slider', min: 0.25, max: 4, step: 0.05, default: 1, format: 'x' }]
  },
  {
    id: 'video.crop', section: 'video', group: 'visual', icon: 'crop', batch: true, inputKind: 'video',
    params: [
      { key: 'ratio', type: 'ratio', default: 'custom' },
      { key: 'w', type: 'number', default: 0, min: 0, labelKey: 'param.width' },
      { key: 'h', type: 'number', default: 0, min: 0, labelKey: 'param.height' },
      { key: 'x', type: 'number', default: 0, min: 0 },
      { key: 'y', type: 'number', default: 0, min: 0 }
    ]
  },
  {
    id: 'video.scale', section: 'video', group: 'visual', icon: 'scale', batch: true, inputKind: 'video',
    params: [
      { key: 'size', type: 'size', default: '720p' },
      { key: 'width', type: 'number', default: 1280, min: 16, showIf: (p) => p.size === 'custom' },
      { key: 'height', type: 'number', default: 720, min: 16, showIf: (p) => p.size === 'custom' },
      { key: 'mode', type: 'segmented', options: [
        { value: 'fit', labelKey: 'param.fit' },
        { value: 'stretch', labelKey: 'param.stretch' }
      ], default: 'fit' }
    ]
  },
  {
    id: 'video.rotate', section: 'video', group: 'visual', icon: 'rotate', batch: true, inputKind: 'video',
    params: [
      { key: 'angle', type: 'segmented', options: ['0', '90', '180', '270'], default: '90' },
      { key: 'flipH', type: 'switch', default: false, labelKey: 'param.flipH' },
      { key: 'flipV', type: 'switch', default: false, labelKey: 'param.flipV' }
    ]
  },
  {
    id: 'video.extractFrames', section: 'video', group: 'export', icon: 'frames', batch: true, inputKind: 'video',
    params: [
      { key: 'mode', type: 'segmented', options: [
        { value: 'sequence', labelKey: 'param.sequence' },
        { value: 'single', labelKey: 'param.single' }
      ], default: 'sequence' },
      { key: 'fps', type: 'number', default: 1, min: 0.1, step: 0.5, showIf: (p) => p.mode === 'sequence' },
      { key: 'timeSec', type: 'time', default: 0, labelKey: 'param.time', showIf: (p) => p.mode === 'single' },
      { key: 'format', type: 'select', options: ['png', 'jpg'], default: 'png' }
    ]
  },
  {
    id: 'video.anim', section: 'video', group: 'export', icon: 'anim', batch: true, inputKind: 'video',
    params: [
      { key: 'format', type: 'segmented', options: ['gif', 'webp'], default: 'gif' },
      { key: 'startSec', type: 'time', default: 0, labelKey: 'param.start' },
      { key: 'endSec', type: 'time', default: null, labelKey: 'param.end' },
      { key: 'fps', type: 'number', default: 12, min: 1, max: 30, step: 1 },
      { key: 'width', type: 'number', default: 480, min: 32, step: 10 },
      { key: 'quality', type: 'slider', min: 1, max: 100, step: 1, default: 75, showIf: (p) => p.format === 'webp' },
      { key: 'colors', type: 'select', options: ['64', '128', '256'], default: '128', showIf: (p) => p.format === 'gif' }
    ]
  },
  { id: 'video.metadata', section: 'video', group: 'export', icon: 'metadata', batch: false, modal: true, inputKind: 'video', params: [] },

  // ------------------------------------------------------------- audio page
  {
    id: 'audio.convert', section: 'audio', group: 'convert', icon: 'convert', batch: true, inputKind: 'audio',
    params: [
      { key: 'format', type: 'select', options: ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus'], default: 'mp3' },
      { key: 'bitrate', type: 'select', options: BITRATES, default: '192', showIf: (p) => !['flac', 'wav'].includes(p.format) },
      { key: 'sampleRate', type: 'select', options: ['0', '44100', '48000'], default: '0', optionLabelKeys: { 0: 'param.original' } },
      { key: 'channels', type: 'select', options: ['0', '1', '2'], default: '0', optionLabelKeys: { 0: 'param.original' } }
    ]
  },
  {
    id: 'audio.compress', section: 'audio', group: 'convert', icon: 'compress', batch: true, inputKind: 'audio',
    params: [{ key: 'bitrate', type: 'select', options: ['64', '96', '128', '160', '192'], default: '128' }]
  },
  {
    id: 'audio.trim', section: 'audio', group: 'edit', icon: 'trim', batch: true, inputKind: 'audio',
    params: [
      { key: 'startSec', type: 'time', default: 0, labelKey: 'param.start' },
      { key: 'endSec', type: 'time', default: null, labelKey: 'param.end' }
    ]
  },
  {
    id: 'audio.volume', section: 'audio', group: 'process', icon: 'volume', batch: true, inputKind: 'audio',
    params: [{ key: 'db', type: 'slider', min: -30, max: 30, step: 0.5, default: 0, format: 'dB' }]
  },
  {
    id: 'audio.loudnorm', section: 'audio', group: 'process', icon: 'loudnorm', batch: true, inputKind: 'audio',
    params: [
      { key: 'target', type: 'slider', min: -30, max: -5, step: 1, default: -16, format: 'LUFS' },
      { key: 'tp', type: 'slider', min: -3, max: 0, step: 0.5, default: -1.5, format: 'dBTP' },
      { key: 'lra', type: 'slider', min: 1, max: 20, step: 1, default: 11, format: 'LRA' }
    ]
  },
  // Track operations take a VIDEO as main input.
  {
    id: 'audio.extract', section: 'audio', group: 'track', icon: 'extractAudio', batch: true, inputKind: 'video',
    params: [
      { key: 'format', type: 'select', options: ['copy', 'mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus'], default: 'copy', optionLabelKeys: { copy: 'param.original' } },
      { key: 'bitrate', type: 'select', options: BITRATES, default: '192', showIf: (p) => p.format !== 'copy' && p.format !== 'flac' && p.format !== 'wav' }
    ],
    mapsTo: 'video.extractAudio'
  },
  { id: 'audio.removeTrack', section: 'audio', group: 'track', icon: 'mute', batch: true, inputKind: 'video', params: [], mapsTo: 'video.mute' },
  {
    id: 'audio.replaceTrack', section: 'audio', group: 'track', icon: 'replaceAudio', batch: true, inputKind: 'video', extraInput: 'audio',
    params: [{ key: 'audioBitrate', type: 'select', options: BITRATES, default: '192' }],
    mapsTo: 'video.replaceAudio'
  },

  // ---------------------------------------------------------- subtitle page
  {
    id: 'subtitle.convert', section: 'subtitle', group: 'convert', icon: 'convert', batch: true, instant: true, inputKind: 'subtitle',
    params: [{ key: 'targetFormat', type: 'select', options: ['srt', 'vtt', 'ass', 'ssa', 'ttml'], default: 'srt' }]
  },
  {
    id: 'subtitle.shift', section: 'subtitle', group: 'convert', icon: 'shift', batch: true, instant: true, inputKind: 'subtitle',
    params: [
      { key: 'direction', type: 'segmented', options: [
        { value: 'earlier', labelKey: 'param.earlier' },
        { value: 'later', labelKey: 'param.later' }
      ], default: 'later' },
      { key: 'shiftSec', type: 'number', default: 1, min: 0.001, step: 0.5, labelKey: 'param.offset' },
      { key: 'overwrite', type: 'switch', default: false, labelKey: 'param.overwrite' }
    ]
  },
  {
    id: 'subtitle.reencode', section: 'subtitle', group: 'convert', icon: 'reencode', batch: true, instant: true, inputKind: 'subtitle',
    params: [
      { key: 'charset', type: 'select', options: ['utf-8', 'utf-8bom', 'utf-16le', 'utf-16be'], default: 'utf-8' },
      { key: 'overwrite', type: 'switch', default: false, labelKey: 'param.overwrite' }
    ]
  },
  {
    id: 'subtitle.extract', section: 'subtitle', group: 'embed', icon: 'extractSubs', batch: false, inputKind: 'video',
    params: [
      { key: 'streamIndex', type: 'stream', default: 0 },
      { key: 'format', type: 'select', options: ['srt', 'vtt', 'ass'], default: 'srt' }
    ]
  },
  {
    id: 'subtitle.mux', section: 'subtitle', group: 'embed', icon: 'embedSubs', batch: true, inputKind: 'video', extraInput: 'subtitle', extraMultiple: true,
    params: [
      { key: 'container', type: 'select', options: ['mp4', 'mkv'], default: 'mp4' },
      { key: 'language', type: 'text', default: '', placeholder: 'chi / eng' }
    ],
    mapsTo: 'video.embedSubs'
  },
  {
    id: 'subtitle.burn', section: 'subtitle', group: 'embed', icon: 'burnSubs', batch: true, inputKind: 'video', extraInput: 'subtitle',
    params: [
      { key: 'fontSize', type: 'number', default: 24, min: 8, max: 96, step: 1 },
      { key: 'margin', type: 'number', default: 30, min: 0, max: 200, step: 5, labelKey: 'param.margin' }
    ],
    mapsTo: 'video.burnSubs'
  }
];

export function opsForSection(section) {
  return OPS.filter((o) => o.section === section);
}

export function defaultParams(op) {
  const p = {};
  for (const param of op.params) {
    if (param.type === 'stream') continue; // resolved dynamically
    p[param.key] = param.default;
  }
  return p;
}

// Resolve UI-only params into engine params before adding jobs.
// Hardware/GPU substitution and audio auto-copy are resolved centrally in
// shared/resolve.mjs (renderer plan + main.js job submission).
export function engineParams(opId, params, files) {
  const p = { ...params };
  const first = files[0];
  const probe = first && first.probe;

  // Quality presets (normal mode) resolve into concrete encoder settings.
  if ((opId === 'video.convert' || opId === 'video.compress') && !p.advanced) {
    const preset = QUALITY_PRESETS[p.qualityPreset] || QUALITY_PRESETS.balanced;
    p.videoCodec = preset.videoCodec;
    p.crf = preset.crf;
    p.encodeSpeed = preset.encodeSpeed;
    p.audioBitrate = preset.audioBitrate;
    p.mode = 'crf';
    if (opId === 'video.convert') p.audioCodec = p.audioCodec || 'auto';
  }
  delete p.advanced;
  // CRF mode must never carry a stray target bitrate (plan/command honesty).
  if (p.mode !== 'bitrate') delete p.videoBitrate;

  if (opId === 'video.scale') {
    const sizes = { '1080p': [1920, 1080], '720p': [1280, 720], '480p': [854, 480], '360p': [640, 360] };
    if (p.size !== 'custom' && sizes[p.size]) {
      p.width = sizes[p.size][0];
      p.height = sizes[p.size][1];
    }
    delete p.size;
  }
  if (opId === 'video.crop') {
    if (p.ratio && p.ratio !== 'custom' && probe && probe.video) {
      const [rw, rh] = p.ratio.split(':').map(Number);
      const W = probe.video.width || 1920;
      const H = probe.video.height || 1080;
      let w = W;
      let h = Math.round((W * rh) / rw);
      if (h > H) {
        h = H;
        w = Math.round((H * rw) / rh);
      }
      p.w = w - (w % 2);
      p.h = h - (h % 2);
      p.x = Math.floor((W - p.w) / 2);
      p.y = Math.floor((H - p.h) / 2);
    }
    delete p.ratio;
  }
  if (opId === 'subtitle.shift') {
    p.offsetMs = Math.round((p.direction === 'earlier' ? -1 : 1) * Math.abs(Number(p.shiftSec) || 0) * 1000);
    delete p.direction;
    delete p.shiftSec;
  }
  if (opId === 'video.trim' || opId === 'audio.trim' || opId === 'video.anim') {
    for (const k of ['startSec', 'endSec']) {
      if (p[k] === '' || p[k] == null) p[k] = k === 'startSec' ? 0 : null;
    }
  }
  // Numeric selects arrive as strings; normalize the ones the engine treats as numbers.
  for (const k of ['audioBitrate', 'bitrate', 'videoBitrate', 'sampleRate', 'channels', 'colors', 'fps', 'fontSize', 'margin', 'width', 'height', 'w', 'h', 'x', 'y', 'crf']) {
    if (p[k] != null && p[k] !== '' && !isNaN(Number(p[k]))) p[k] = Number(p[k]);
  }
  if (p.languages == null && p.language) p.languages = [p.language];
  return p;
}

export { QUALITY_PRESETS };
