// Bounded media reads settle only after child close so canceled work has stopped.
const { spawn } = require('node:child_process');
const contract = require('../../shared/media-contract.json');

function abortError(tool) {
  const error = new Error(`${tool} aborted`);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function readOutput(bin, args, { timeoutMs = 30000, signal, maxOutputBytes = 16 * 1024 * 1024, tool = 'ffprobe' } = {}) {
  if (signal?.aborted) return Promise.reject(abortError(tool));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks = [];
    let err = '';
    let bytes = 0;
    let failure;
    const stop = error => {
      if (!failure) failure = error;
      child.kill('SIGKILL');
    };
    const onAbort = () => stop(abortError(tool));
    const timer = setTimeout(() => stop(new Error(`${tool} timeout`)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => {
      if (failure) return;
      bytes += d.length;
      if (bytes > maxOutputBytes) stop(new Error(`${tool} output exceeds limit`));
      else chunks.push(d);
    });
    child.stderr.on('data', d => { err = (err + d).slice(-65536); });
    child.on('error', error => { failure ||= error; });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (failure) reject(failure);
      else if (code === 0) resolve(Buffer.concat(chunks, bytes));
      else reject(new Error(err || `${tool} exited with ${code}`));
    });
  });
}

async function probe(bin, filePath, options = {}) {
  const output = await readOutput(bin, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams',
    '-show_data_hash', 'sha256', filePath
  ], options);
  return JSON.parse(output.toString('utf8'));
}

async function previewFrame(bin, filePath, signal) {
  const output = await readOutput(bin, [
    '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-threads', '1', '-i', filePath,
    '-map', '0:V:0', '-filter_threads', '1',
    '-vf', 'scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-frames:v', '1', '-c:v', 'mjpeg', '-threads', '1', '-f', 'image2pipe', 'pipe:1'
  ], { signal, timeoutMs: 8000, maxOutputBytes: 1024 * 1024, tool: 'ffmpeg' });
  if (!output.length) throw new Error('No video frame was decoded');
  return `data:image/jpeg;base64,${output.toString('base64')}`;
}

function finite(value) {
  if (value == null || value === '' || value === 'N/A') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFps(s) {
  for (const rate of [s.avg_frame_rate, s.r_frame_rate]) {
    const [n, d] = String(rate || '').split('/').map(Number);
    if (n > 0 && d > 0) return n / d;
  }
  return null;
}

function parseRotation(s) {
  const data = (s.side_data_list || []).find(d => d.rotation !== undefined);
  return finite(data?.rotation ?? s.tags?.rotate) || 0;
}

function identifyContainer(f, sourcePath) {
  const ext = (String(sourcePath || f.filename || '').match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase();
  if (contract.pathContainers[ext]) return contract.pathContainers[ext];
  const aliases = String(f.format_name || '').split(',');
  if (aliases.length === 1) return ({ matroska: 'mkv' })[aliases[0]] || contract.pathContainers[aliases[0]] || null;
  // ISO brands can distinguish QuickTime; other alias families remain unknown.
  if (String(f.tags?.major_brand || '').trim() === 'qt') return 'mov';
  return null;
}

function summarizeStream(s) {
  let duration = finite(s.duration);
  const tagged = String(s.tags?.DURATION || '').match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (duration == null && tagged) duration = Number(tagged[1]) * 3600 + Number(tagged[2]) * 60 + Number(tagged[3]) - (finite(s.start_time) || 0);
  return {
    index: s.index, type: s.codec_type, codec: s.codec_name,
    codecTag: s.codec_tag_string, profile: s.profile, level: s.level,
    timeBase: s.time_base, startTime: finite(s.start_time), durationSec: duration,
    bitrate: finite(s.bit_rate), frames: finite(s.nb_frames),
    width: s.width, height: s.height, fps: parseFps(s),
    frameRate: s.avg_frame_rate && s.avg_frame_rate !== '0/0' ? s.avg_frame_rate : s.r_frame_rate,
    pixFmt: s.pix_fmt, sampleAspectRatio: s.sample_aspect_ratio,
    displayAspectRatio: s.display_aspect_ratio, rotation: parseRotation(s),
    fieldOrder: s.field_order, colorRange: s.color_range, colorSpace: s.color_space,
    colorTransfer: s.color_transfer, colorPrimaries: s.color_primaries,
    sampleRate: finite(s.sample_rate), channels: s.channels,
    channelLayout: s.channel_layout, sampleFormat: s.sample_fmt,
    bitsPerRawSample: s.bits_per_raw_sample,
    // Zero is meaningful: probe completed but this codec has no extradata.
    extradataSize: finite(s.extradata_size) ?? 0,
    extradataHash: s.extradata_hash || null,
    attachedPic: Boolean(s.disposition?.attached_pic), disposition: s.disposition || {},
    language: s.tags?.language || s.tags?.LANGUAGE || '', tags: s.tags || {}
  };
}

// Selected streams use stable first-in-source order, not ffmpeg's automatic
// highest-resolution/default-track heuristic. Builders explicitly map these IDs.
function summarize(p, sourcePath) {
  const f = p.format || {};
  const streams = (p.streams || []).map(summarizeStream);
  const videoStreams = streams.filter(s => s.type === 'video');
  const audioStreams = streams.filter(s => s.type === 'audio');
  return {
    durationSec: finite(f.duration), startTime: finite(f.start_time),
    bitrate: finite(f.bit_rate), size: finite(f.size),
    sourcePath: sourcePath || f.filename || null,
    container: identifyContainer(f, sourcePath), formatName: f.format_name || '',
    video: videoStreams.find(s => !s.attachedPic) || null,
    audio: audioStreams[0] || null,
    streams, videoStreams, audioStreams,
    subtitleStreams: streams.filter(s => s.type === 'subtitle'),
    streamCount: streams.length
  };
}

module.exports = { probe, previewFrame, summarize };
