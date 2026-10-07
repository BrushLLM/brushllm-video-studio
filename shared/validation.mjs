// Pure parameter validation shared by renderer and the trusted IPC boundary.
// Missing source duration is unknown, not zero. This module never coerces or mutates params.
export function validateOperation(op, params = {}, source = null, opts = {}) {
  const p = params || {};
  const issues = [];
  const add = (field, code, message) => issues.push({ field, code, message });
  const present = value => value != null && value !== '';
  const finite = value => present(value) && typeof value !== 'boolean' && Number.isFinite(Number(value));
  const positive = (field, value, required = false) => {
    if ((required || present(value)) && (!finite(value) || Number(value) <= 0)) add(field, 'positive-number', `${field} must be a positive number`);
  };
  const knownDuration = finite(source?.durationSec) && Number(source.durationSec) > 0 ? Number(source.durationSec) : null;
  if (['video.convert', 'video.compress', 'video.merge'].includes(op) && (p.rateControl || p.mode) === 'bitrate') positive('videoBitrate', p.videoBitrate, true);
  for (const field of ['bitrate', 'audioBitrate']) {
    if (Object.hasOwn(p, field)) positive(field, p[field], true);
  }
  if (['video.trim', 'audio.trim', 'video.anim'].includes(op)) {
    const start = p.startSec === undefined || p.startSec === null ? 0 : p.startSec;
    if (!finite(start) || Number(start) < 0) add('startSec', 'invalid-time', 'Start time must be a non-negative number');
    if (present(p.endSec) && (!finite(p.endSec) || Number(p.endSec) <= Number(start))) add('endSec', 'invalid-time-range', 'End time must be greater than start time');
    if (knownDuration != null && finite(start) && Number(start) >= knownDuration) add('startSec', 'outside-duration', 'Start time must precede the end of the media');
    if (knownDuration != null && finite(p.endSec) && Number(p.endSec) > knownDuration + 0.05) add('endSec', 'outside-duration', 'End time exceeds the media duration');
  }
  if (op === 'video.extractFrames') {
    if (p.mode === 'single') {
      const t = p.timeSec === undefined ? 0 : p.timeSec;
      if (!finite(t) || Number(t) < 0) add('timeSec', 'invalid-time', 'Frame time must be a non-negative number');
      else if (knownDuration != null && Number(t) >= knownDuration) add('timeSec', 'outside-duration', 'Frame time must precede the end of the media');
    } else positive('fps', p.fps ?? 1, true);
  }
  const evenDimension = (field, value, required) => {
    if (!required && !present(value)) return;
    if (!finite(value) || !Number.isInteger(Number(value)) || Number(value) < 2 || Number(value) % 2) add(field, 'even-dimension', `${field} must be a positive even integer`);
  };
  if (op === 'video.scale') {
    const preset = ['1080p', '720p', '480p', '360p'].includes(p.size);
    evenDimension('width', p.width, !preset);
    evenDimension('height', p.height, !preset);
  }
  if (op === 'video.crop') {
    evenDimension('w', p.w, true);
    evenDimension('h', p.h, true);
    for (const field of ['x', 'y']) if (present(p[field]) && (!finite(p[field]) || !Number.isInteger(Number(p[field])) || Number(p[field]) < 0)) add(field, 'crop-offset', 'Crop offsets must be non-negative integers');
    if (source?.video && Number(p.w) + Number(p.x || 0) > source.video.width) add('w', 'crop-bounds', 'Crop exceeds the video width');
    if (source?.video && Number(p.h) + Number(p.y || 0) > source.video.height) add('h', 'crop-bounds', 'Crop exceeds the video height');
  }
  if (op === 'video.speed' && (!finite(p.factor ?? 1) || Number(p.factor ?? 1) < 0.25 || Number(p.factor ?? 1) > 4)) add('factor', 'speed-range', 'Speed must be between 0.25 and 4');
  if (present(p.sampleRate) && (!finite(p.sampleRate) || Number(p.sampleRate) < 8000 || !Number.isInteger(Number(p.sampleRate)))) add('sampleRate', 'sample-rate', 'Invalid sample rate');
  if (present(p.channels) && (!finite(p.channels) || !Number.isInteger(Number(p.channels)) || Number(p.channels) < 1 || Number(p.channels) > 8)) add('channels', 'channels', 'Channels must be between 1 and 8');
  const audioCodec = p.format === 'opus' || p.audioCodec === 'opus' || (['audio.volume', 'audio.loudnorm', 'audio.compress'].includes(op) && source?.audio?.codec === 'opus') || (p.container === 'webm' && p.audioCodec !== 'copy') ? 'opus' : p.audioCodec;
  if (audioCodec === 'opus') {
    if (present(p.sampleRate) && ![8000, 12000, 16000, 24000, 48000].includes(Number(p.sampleRate))) add('sampleRate', 'opus-sample-rate', 'Opus supports 8000, 12000, 16000, 24000 or 48000 Hz (not 44100 Hz)');
    const channels = Number(p.channels || source?.audio?.channels || 2);
    const bitrate = Number(p.bitrate ?? p.audioBitrate ?? 160);
    if (Number.isFinite(bitrate) && (bitrate < 6 || bitrate > 256 * channels)) add(p.bitrate !== undefined ? 'bitrate' : 'audioBitrate', 'opus-bitrate', `Opus bitrate must be between 6 and ${256 * channels} kbps for ${channels} channel(s)`);
  }
  if (op === 'video.merge' && (opts.allProbes || []).some(s => (s?.audioStreams?.length || 0) > 1 || (s?.videoStreams?.filter(v => !v.attachedPic).length || 0) > 1) && (p.mergeMode || p.mode) === 'reencode') add('mode', 'ambiguous-streams', 'Re-encode merge requires one main video and at most one audio stream per input; multi-track correspondence is ambiguous');
  return issues;
}

export function assertValidOperation(op, params = {}, source = null, opts = {}) {
  const issues = validateOperation(op, params, source, opts);
  if (issues.length) {
    const error = new Error(issues.map(issue => issue.message).join('; '));
    error.code = 'INVALID_PARAMETERS';
    error.issues = issues;
    throw error;
  }
  return params;
}
