// File-kind detection, container identity and stream contracts shared by UI/planning.
const contract = require('./media-contract.json');

const AUDIO_FORMATS = contract.audioFormats;
const AUDIO_CODEC_EXTENSIONS = contract.audioCodecExtensions;

function containerOfPath(filePath) {
  const ext = (String(filePath || '').match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase();
  return contract.pathContainers[ext] || null;
}

// ffprobe reports demuxer aliases, NOT an unambiguous container identity.
function containerOfSource(source = {}) {
  if (source.container) return source.container;
  const byPath = containerOfPath(source.sourcePath);
  if (byPath) return byPath;
  const aliases = String(source.formatName || '').split(',');
  if (aliases.length !== 1) return null;
  return ({ matroska: 'mkv' })[aliases[0]] || contract.pathContainers[aliases[0]] || null;
}

function editContainer(source = {}) {
  const c = containerOfSource(source);
  return ['mp4', 'mkv', 'mov'].includes(c) ? c : 'mp4';
}

function audioOutputExtension(codec) {
  return AUDIO_CODEC_EXTENSIONS[codec] || '.mka';
}

function displaySize(video = {}) {
  const [n, d] = String(video.sampleAspectRatio || '1:1').split(/[:/]/).map(Number);
  let width = Math.max(2, Math.round(Number(video.width) * (n > 0 && d > 0 ? n / d : 1) / 2) * 2);
  let height = Math.max(2, Math.round(Number(video.height) / 2) * 2);
  if (Math.abs(Number(video.rotation) || 0) % 180 === 90) [width, height] = [height, width];
  return { width, height };
}

function mergeCopyCompatibility(probes = []) {
  if (probes.length < 2) return { compatible: false, reason: 'At least two complete probes are required for copy merge' };
  let first;
  for (const p of probes) {
    if (!p?.streams?.length || !(p.durationSec > 0)) return { compatible: false, reason: 'Copy merge requires complete stream metadata and known durations' };
    const signatures = [];
    for (const s of p.streams) {
      const required = contract.copyRequired[s.type];
      if (!required || s.attachedPic || required.some(k => s[k] == null || s[k] === '' || s[k] === 'unknown' || s[k] === '0/0')) {
        return { compatible: false, reason: 'Copy merge stream metadata is incomplete or contains unsupported streams' };
      }
      if (s.extradataSize == null || (s.extradataSize > 0 && !s.extradataHash)) return { compatible: false, reason: 'Copy merge requires codec initialization data' };
      signatures.push(contract.copyCompare.map(k => s[k] ?? null));
    }
    const signature = JSON.stringify(signatures);
    if (first !== undefined && signature !== first) return { compatible: false, reason: 'Copy merge stream order, time bases or codec parameters differ' };
    first = signature;
  }
  return { compatible: true, reason: null };
}

const VIDEO_EXTS = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'flv', 'wmv', 'vob', 'ogv', '3gp'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'mka', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'oga'];
const SUBTITLE_EXTS = ['srt', 'vtt', 'ass', 'ssa', 'ttml', 'xml', 'dfxp'];

// Unknown extensions are NOT silently treated as video.
function fileKindOf(name) {
  const ext = (String(name).match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  if (SUBTITLE_EXTS.includes(ext)) return 'subtitle';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return 'other';
}

// What each page accepts as main input.
const SECTION_ACCEPTS = {
  video: ['video'],
  audio: ['audio', 'video'],
  subtitle: ['subtitle', 'video']
};

function acceptsFor(section) {
  return SECTION_ACCEPTS[section] || ['video', 'audio', 'subtitle'];
}

// Filter dragged/dropped/picked paths for a section; returns { accepted, rejected }.
function filterForSection(paths, section) {
  const accepts = acceptsFor(section);
  const accepted = [];
  const rejected = [];
  for (const p of paths) {
    (accepts.includes(fileKindOf(p)) ? accepted : rejected).push(p);
  }
  return { accepted, rejected };
}

// Main input files for an op: filtered by the op's declared input kind.
function inputFilesForOp(files, inputKind) {
  if (!inputKind || inputKind === 'any') return files;
  return files.filter((f) => f.kind === inputKind);
}



module.exports = { containerOfPath, containerOfSource, editContainer, audioOutputExtension, displaySize, mergeCopyCompatibility, AUDIO_FORMATS, AUDIO_CODEC_EXTENSIONS, fileKindOf, filterForSection, inputFilesForOp, acceptsFor, VIDEO_EXTS, AUDIO_EXTS, SUBTITLE_EXTS };
