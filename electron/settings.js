const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_SETTINGS = Object.freeze({ language: 'system', ffmpegPath: '', ffprobePath: '', outputDir: '', concurrency: 1, preventSleep: true });
const LANGUAGES = new Set(['system', 'en', 'de', 'es', 'fr', 'pt-BR', 'ja', 'ko', 'zh-CN', 'zh-TW']);

function normalizeSettings(value = {}, { strict = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new Error('Invalid settings');
    value = {};
  }
  const next = { ...DEFAULT_SETTINGS };
  for (const key of ['ffmpegPath', 'ffprobePath', 'outputDir']) {
    if (typeof value[key] === 'string') {
      if (value[key] && !path.isAbsolute(value[key])) { if (strict) throw new Error(`${key} must be an absolute path`); }
      else next[key] = value[key];
    } else if (value[key] != null && strict) throw new Error(`Invalid ${key}`);
  }
  if (LANGUAGES.has(value.language)) next.language = value.language;
  else if (value.language != null && strict) throw new Error('Unsupported language');
  const n = Number(value.concurrency);
  if (Number.isInteger(n)) next.concurrency = Math.max(1, Math.min(4, n));
  else if (value.concurrency != null && strict) throw new Error('Invalid concurrency');
  if (typeof value.preventSleep === 'boolean') next.preventSleep = value.preventSleep;
  else if (value.preventSleep != null && strict) throw new Error('Invalid preventSleep');
  return next;
}

function validateEngine(filePath, name) {
  if (!filePath) return;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`${name} must be an executable file`);
  fs.accessSync(filePath, process.platform === 'win32' ? fs.constants.R_OK : fs.constants.X_OK);
  const output = execFileSync(filePath, ['-version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (!output.toLowerCase().startsWith(`${name} version`)) throw new Error(`Selected file is not ${name}`);
}

function saveSettingsFile(filePath, settings) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const dir = fs.mkdtempSync(path.join(path.dirname(filePath), '.settings-'));
  try {
    const staged = path.join(dir, 'settings.json');
    fs.writeFileSync(staged, JSON.stringify(settings, null, 2), { flag: 'wx' });
    fs.renameSync(staged, filePath);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings, validateEngine, saveSettingsFile };
