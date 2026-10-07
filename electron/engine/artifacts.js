const fs = require('node:fs');
const path = require('node:path');

function exists(p) {
  try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

function numberedPath(p, n) {
  if (!n) return p;
  const ext = path.extname(p);
  return path.join(path.dirname(p), `${path.basename(p, ext)}-${n}${ext}`);
}

function identity(p) {
  const s = fs.lstatSync(p);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error('Output is not a regular file');
  return { path: p, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs };
}

function unchanged(file) {
  try {
    const now = identity(file.path);
    return ['dev', 'ino', 'size', 'mtimeMs'].every((key) => now[key] === file[key]);
  } catch { return false; }
}

function reservePath(desired, reserved) {
  for (let n = 0; n < 10000; n++) {
    const candidate = numberedPath(path.resolve(desired), n);
    if (!reserved.has(candidate) && !exists(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new Error('Could not allocate a unique output name');
}

function publishFile(staged, desired) {
  const stat = identity(staged);
  if (!stat.size) throw new Error('Processing produced an empty output');
  for (let n = 0; n < 10000; n++) {
    const outputPath = numberedPath(desired, n);
    try {
      // The staging file is on the destination filesystem. link() never replaces a target.
      fs.linkSync(staged, outputPath);
      return { kind: 'file', outputPath, files: [identity(outputPath)] };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Could not publish the output without replacing a file');
}

function publishSequence(stagedPattern, desiredDirectory) {
  const dir = path.dirname(stagedPattern);
  const pattern = path.basename(stagedPattern);
  const parts = pattern.split('%05d');
  if (parts.length > 2) throw new Error('Invalid frame output pattern');
  const matches = (name) => parts.length === 1 ? name === pattern :
    name.startsWith(parts[0]) && name.endsWith(parts[1]) &&
    /^\d{5,}$/.test(name.slice(parts[0].length, name.length - parts[1].length));
  const names = fs.readdirSync(dir).filter(matches).sort();
  if (!names.length) throw new Error('Processing produced no frames');
  for (const name of names) if (!identity(path.join(dir, name)).size) throw new Error('Processing produced an empty frame');
  for (let n = 0; n < 10000; n++) {
    const directory = numberedPath(desiredDirectory, n);
    try { fs.mkdirSync(directory); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    const files = [];
    try {
      for (const name of names) {
        const dest = path.join(directory, name);
        fs.linkSync(path.join(dir, name), dest);
        files.push(identity(dest));
      }
      const stat = fs.lstatSync(directory);
      return { kind: 'sequence', directory, directoryIdentity: { dev: stat.dev, ino: stat.ino }, outputPath: path.join(directory, pattern), files };
    } catch (e) {
      for (const file of files) if (unchanged(file)) fs.unlinkSync(file.path);
      try { fs.rmdirSync(directory); } catch { /* Preserve files not owned by this publish attempt. */ }
      throw e;
    }
  }
  throw new Error('Could not allocate a frame output directory');
}

function deleteArtifact(artifact, inputs = []) {
  if (!artifact || !Array.isArray(artifact.files) || !artifact.files.length) return { ok: false, error: 'No registered output' };
  const protectedPaths = new Set(inputs.map((p) => path.resolve(p)));
  if (artifact.directory) {
    try {
      const stat = fs.lstatSync(artifact.directory);
      if (stat.isSymbolicLink() || stat.dev !== artifact.directoryIdentity.dev || stat.ino !== artifact.directoryIdentity.ino) {
        return { ok: false, error: 'Output directory was replaced' };
      }
    } catch (e) { if (e.code !== 'ENOENT') return { ok: false, error: e.message }; }
  }
  for (const file of artifact.files) {
    if (protectedPaths.has(path.resolve(file.path))) return { ok: false, error: 'Cannot delete an input file' };
    if (exists(file.path) && !unchanged(file)) return { ok: false, error: 'Output was modified or replaced; it was not deleted' };
  }
  try {
    for (const file of artifact.files) if (exists(file.path)) fs.unlinkSync(file.path);
    if (artifact.directory) {
      try { fs.rmdirSync(artifact.directory); } catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e; }
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function writeNewFile(desired, buffer) {
  fs.mkdirSync(path.dirname(desired), { recursive: true });
  const dir = fs.mkdtempSync(path.join(path.dirname(desired), '.brushvs-write-'));
  try {
    const staged = path.join(dir, path.basename(desired));
    fs.writeFileSync(staged, buffer, { flag: 'wx' });
    return publishFile(staged, desired).outputPath;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function replaceWithBackup(filePath, original, buffer) {
  if (!buffer.length) throw new Error('Refusing to overwrite a file with empty content');
  const before = identity(filePath);
  if (!fs.readFileSync(filePath).equals(original)) throw new Error('Input changed while processing');
  const backupPath = writeNewFile(`${filePath}.bak`, original);
  const dir = fs.mkdtempSync(path.join(path.dirname(filePath), '.brushvs-write-'));
  const held = path.join(dir, 'original');
  let keepRecovery = false;
  try {
    const staged = path.join(dir, 'replacement');
    fs.writeFileSync(staged, buffer, { flag: 'wx' });
    if (!unchanged(before) || !fs.readFileSync(filePath).equals(original)) throw new Error('Input changed while processing; original not overwritten');
    // Retain the file actually removed from the path, including a concurrent replacement.
    fs.renameSync(filePath, held);
    try {
      const captured = identity(held);
      if (!['dev', 'ino', 'size', 'mtimeMs'].every((key) => captured[key] === before[key]) || !fs.readFileSync(held).equals(original)) {
        throw new Error('Input changed while processing');
      }
      fs.linkSync(staged, filePath);
    } catch (error) {
      try { fs.linkSync(held, filePath); } catch {
        keepRecovery = true;
        error.message += `; preserved the displaced file at ${held}`;
        error.recoveryPath = held;
      }
      throw error;
    }
    return { outputPath: filePath, backupPath };
  } finally {
    if (!keepRecovery) fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { identity, unchanged, reservePath, publishFile, publishSequence, deleteArtifact, writeNewFile, replaceWithBackup };
