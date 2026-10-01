// File-kind detection and per-section accept lists, shared by renderer and tests.

const VIDEO_EXTS = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'flv', 'wmv', 'vob', 'ogv', '3gp'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'oga'];
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

export { fileKindOf, acceptsFor, filterForSection, inputFilesForOp, VIDEO_EXTS, AUDIO_EXTS, SUBTITLE_EXTS };
