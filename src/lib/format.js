export function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatBitrate(bps) {
  if (!bps || bps <= 0) return '—';
  if (bps > 1000000) return `${(bps / 1000000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export function formatTime(sec) {
  if (sec == null || sec === '') return '';
  const n = Number(sec);
  if (!isFinite(n)) return '';
  const m = Math.floor(n / 60);
  const s = Math.round((n % 60) * 10) / 10;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// "1:23.5" / "83.5" / "01:23:30" -> seconds
export function parseTimeInput(str) {
  if (str == null || String(str).trim() === '') return null;
  const s = String(str).trim();
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/))) {
    return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  }
  if ((m = s.match(/^(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/))) {
    return +m[1] * 60 + parseFloat(m[2]);
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
