// Media fixture generation for regression tests.
// Creates real FFmpeg test media in system temp directory (never touches tests/media/out).
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveBinaries } = require('../../electron/engine/binaries');

const FFMPEG = resolveBinaries().ffmpeg;

function ff(args, cwd) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-y', ...args], { 
    encoding: 'utf8',
    cwd: cwd || process.cwd()
  });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed: ${r.stderr?.slice(-800)}`);
  }
  return r;
}

class FixtureSet {
  constructor() {
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidstudio-test-'));
    this.files = {};
  }

  path(name) {
    return path.join(this.tempDir, name);
  }

  // 4s 640x360 h264+aac, keyframe every 1s for precise seeking
  makeBasicVideo(name = 'basic.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-t', '4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Second video with matching specs (for merge tests)
  makeBasicVideo2(name = 'basic2.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
      '-t', '4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Video with non-square SAR (stretch regression)
  makeAnamorphicVideo(name = 'anamorphic.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-t', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-aspect', '4:3', // SAR != 1:1
      '-c:a', 'aac',
      '-shortest', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Video with odd dimensions (must fail)
  makeOddDimensionVideo(name = 'odd.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=641x361:rate=15',
      '-t', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-an', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Audio-only OGG (vorbis)
  makeOggAudio(name = 'audio.ogg') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:a', 'libvorbis', '-b:a', '128k', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Audio-only MKA (opus inside matroska audio)
  makeMkaAudio(name = 'audio.mka') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:a', 'libopus', '-b:a', '96k', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Video with different timebase (30000/1001 vs 1/1000)
  makeNTSCVideo(name = 'ntsc.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30000/1001',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-t', '3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Video with special filename characters (for concat)
  makeSpecialNameVideo(name = "special'name[0].mp4") {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-t', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Single frame video (must fail with error about too short)
  makeSingleFrameVideo(name = 'oneframe.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
      '-frames:v', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-an', out
    ]);
    this.files[name] = out;
    return out;
  }

  // Long-GOP video (precise trim test)
  makeLongGOPVideo(name = 'longgop.mp4') {
    const out = this.path(name);
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
      '-t', '8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-g', '90', // GOP size = 6 seconds at 15fps
      '-c:a', 'aac',
      '-shortest', out
    ]);
    this.files[name] = out;
    return out;
  }

  // MKV with embedded SRT subtitle (mov_text remux test)
  makeMkvWithSubtitle(name = 'with_sub.mkv') {
    const srtPath = this.path('temp.srt');
    fs.writeFileSync(srtPath, 
      '1\n00:00:01,000 --> 00:00:02,000\nTest subtitle\n', 'utf8');
    const videoPath = this.makeBasicVideo('temp_video.mp4');
    const out = this.path(name);
    ff([
      '-i', videoPath,
      '-i', srtPath,
      '-map', '0', '-map', '1',
      '-c', 'copy', '-c:s', 'srt',
      out
    ]);
    this.files[name] = out;
    return out;
  }

  cleanup() {
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  }
}

module.exports = { FixtureSet };
