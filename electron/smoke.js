// Opt-in desktop smoke test through the renderer, preload and installed media engine.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function smoke(window, ffmpeg) {
  let smokeDir;
  let exitCode = 1;
  try {
    smokeDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'brushvs-smoke-'));
    const testVideo = path.join(smokeDir, 'input.mp4');
    const gen = spawnSync(ffmpeg, ['-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-shortest', testVideo], { timeout: 15000, windowsHide: true });
    if (gen.status !== 0) throw new Error(`smoke media generation failed: ${String(gen.stderr || '').slice(-300)}`);

    const r = await window.webContents.executeJavaScript(`(async () => {
      const b = window.brushvs;
      if (!b) return { ok: false, error: 'preload bridge missing' };
      if (typeof b.pathForFile !== 'function') return { ok: false, error: 'pathForFile missing (drag&drop broken)' };
      const settings = await b.getSettings();
      const info = await b.appInfo();
      const rendered = !!document.querySelector('.studio-nav') && !!document.querySelector('.workbench');
      // Exercise both output policies through real IPC, queue and FFmpeg.
      const defaultOutputDir = ${JSON.stringify(path.join(smokeDir, 'global-output'))};
      await b.setSettings({ outputDir: defaultOutputDir });
      const added = await b.addJobs([
        { op: 'video.mute', params: {}, inputs: [${JSON.stringify(testVideo)}], outputDir: '' },
        { op: 'video.mute', params: {}, inputs: [${JSON.stringify(testVideo)}], outputDir: null }
      ]);
      const id = added[0].id;
      const deadline = Date.now() + 60000;
      let job = null;
      let inherited = null;
      while (Date.now() < deadline) {
        const jobs = await b.listJobs();
        job = jobs.find((j) => j.id === id);
        inherited = jobs.find((j) => j.id === added[1].id);
        if ([job, inherited].every(j => j && ['done', 'error', 'canceled'].includes(j.status))) break;
        await new Promise((res) => setTimeout(res, 250));
      }
      await b.setSettings({ outputDir: settings.outputDir || '' });
      const outputPolicyOk = job?.outputPath === ${JSON.stringify(path.join(smokeDir, 'input-muted.mp4'))}
        && inherited?.outputPath === ${JSON.stringify(path.join(smokeDir, 'global-output', 'input-muted.mp4'))};
      return {
        ok: rendered && job?.status === 'done' && inherited?.status === 'done' && outputPolicyOk,
        outputPolicyOk,
        inheritedOutputPath: inherited?.outputPath,
        rendered,
        language: settings.language,
        locale: info.locale,
        arch: info.arch,
        ffmpegPath: info.ffmpegPath,
        ffprobePath: info.ffprobePath,
        gpuEncoders: info.gpuEncoders,
        jobStatus: job ? job.status : 'missing',
        jobError: job && job.error ? job.error : null,
        outputPath: job ? job.outputPath : null,
        actual: job && job.actual ? { size: job.actual.size, durationSec: job.actual.durationSec } : null
      };
    })()`);

    const outputOk = r.outputPath && r.inheritedOutputPath ? fs.existsSync(r.outputPath) && fs.existsSync(r.inheritedOutputPath) : false;
    const vendor = path.join(process.resourcesPath, 'app.asar.unpacked', 'staging', 'vendor');
    const bundled = [r.ffmpegPath, r.ffprobePath].every((binary) => binary && path.dirname(binary) === vendor);
    const ok = Boolean(r.ok && outputOk && (!app.isPackaged || bundled));
    console.log('SMOKE', JSON.stringify({ ...r, outputExists: outputOk, bundled, ok }));
    exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error('SMOKE FAIL', e && e.message ? e.message : String(e));
  } finally {
    if (smokeDir) fs.rmSync(smokeDir, { recursive: true, force: true, maxRetries: 3 });
    app.exit(exitCode);
  }
};
