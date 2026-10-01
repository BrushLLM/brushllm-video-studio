// ffprobe wrapper: returns parsed stream / format metadata for a media file.
const { spawn } = require('node:child_process');

function run(bin, args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffprobe timeout'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err || `ffprobe exited with ${code}`));
    });
  });
}

async function probe(bin, filePath) {
  const out = await run(bin, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);
  return JSON.parse(out);
}

// Compact summary for file lists / job planning.
function summarize(p) {
  const f = p.format || {};
  const streams = p.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');
  return {
    durationSec: parseFloat(f.duration) || 0,
    bitrate: parseInt(f.bit_rate, 10) || 0,
    size: parseInt(f.size, 10) || 0,
    formatName: f.format_name || '',
    video: video
      ? {
          codec: video.codec_name,
          width: video.width,
          height: video.height,
          fps: parseFps(video),
          rotation: parseRotation(video)
        }
      : null,
    audio: audio
      ? { codec: audio.codec_name, sampleRate: audio.sample_rate, channels: audio.channels }
      : null,
    subtitleStreams: subs.map((s, i) => ({
      index: s.index,
      codec: s.codec_name,
      language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || ''
    })),
    streamCount: streams.length
  };
}

function parseFps(s) {
  const [num, den] = (s.avg_frame_rate || s.r_frame_rate || '0/1').split('/').map(Number);
  if (!den) return 0;
  return Math.round((num / den) * 100) / 100;
}

function parseRotation(s) {
  const td = (s.side_data_list || []).find(
    (d) => d.rotation !== undefined || (d.displaymatrix && d.displaymatrix.includes)
  );
  if (td && td.rotation !== undefined) return Math.round(td.rotation);
  return 0;
}

module.exports = { probe, summarize };
