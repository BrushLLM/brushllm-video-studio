import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { fileKindOf, filterForSection, inputFilesForOp } from '../../shared/media.mjs';
import { buildPlan } from '../../shared/plan.mjs';
import { validateOperation } from '../../shared/validation.mjs';
import { opsForSection, defaultParams, engineParams } from '../ops';
import { parseTimeInput } from '../lib/format';
import DropZone from './DropZone';
import FileList from './FileList';
import OperationGrid from './OperationGrid';
import ParamPanel from './ParamPanel';
import ExtraInput from './ExtraInput';
import MetadataModal from './MetadataModal';
import { PlanSummary } from './MediaSummary';
import { Icon } from './icons';

const SECTION_DROP_KIND = { video: 'media', audio: 'audio', subtitle: 'mediaAndSubs' };

export default function ToolPage({ section, files, setFiles, onTransfer, gpuEncoders }) {
  const { t } = useI18n();
  const ops = useMemo(() => opsForSection(section), [section]);
  const [selectedOp, setSelectedOp] = useState(null);
  const [params, setParams] = useState({});
  const [extras, setExtras] = useState({});
  const [sourceCharset, setSourceCharset] = useState('auto');
  const [outputDir, setOutputDir] = useState(null);
  const [instantBusy, setInstantBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [metaFile, setMetaFile] = useState(null);
  const toastTimer = useRef(null);

  const op = ops.find((o) => o.id === selectedOp) || null;

  const showToast = (msg, kind = 'success') => {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  // ------------------------------------------------------------- file intake

  const addFiles = (paths) => {
    const { accepted, rejected } = filterForSection(paths, section);
    if (rejected.length) {
      showToast(t('msg.unsupportedFile', { file: rejected[0].split(/[/\\]/).pop() }), 'error');
    }
    if (!accepted.length) return;
    setFiles((prev) => {
      const requestToken = Date.now() + Math.random();
      const known = new Set(prev.map((f) => f.path));
      const fresh = accepted
        .filter((p) => !known.has(p))
        .map((p) => ({ path: p, name: p.split(/[/\\]/).pop(), kind: fileKindOf(p), probing: false, probe: null, raw: null, requestToken }));
      return [...prev, ...fresh];
    });
  };

  // Probe media files asynchronously once added. Use requestToken to avoid
  // perpetual probing when files are transferred between pages.
  useEffect(() => {
    const toProbe = files.filter((f) => (f.kind === 'video' || f.kind === 'audio') && !f.probe && !f.probing && !f.probeFailed);
    if (!toProbe.length) return;
    setFiles((prev) => prev.map((f) => (toProbe.includes(f) ? { ...f, probing: true } : f)));
    toProbe.forEach(async (f) => {
      const token = f.requestToken;
      try {
        const { raw, summary } = await bridge.probeFile(f.path);
        setFiles((prev) => prev.map((x) => (x.path === f.path && x.requestToken === token ? { ...x, probing: false, probe: summary, raw } : x)));
      } catch {
        setFiles((prev) => prev.map((x) => (x.path === f.path && x.requestToken === token ? { ...x, probing: false, probeFailed: true } : x)));
      }
    });
  }, [files]);

  const browse = async () => {
    const picked = await bridge.openFiles(SECTION_DROP_KIND[section]);
    if (picked?.length) addFiles(picked);
  };

  // ------------------------------------------------------------ op selection

  const selectOp = (id) => {
    const next = ops.find((o) => o.id === id);
    if (next.modal) {
      const first = inputFilesForOp(files, next.inputKind)[0];
      if (!first) { showToast(t('msg.needFiles'), 'error'); return; }
      setMetaFile(first);
      return;
    }
    setSelectedOp(id === selectedOp ? null : id);
    setParams(defaultParams(next));
    setExtras({});
    setSourceCharset('auto');
  };

  // ------------------------------------------------------- plan + validation

  const mainInputs = op ? inputFilesForOp(files, op.inputKind) : [];
  const engineOp = op ? (op.mapsTo || op.id) : null;
  const effectiveParams = op ? engineParams(op.id, params, mainInputs) : params;

  const resolved = useMemo(() => {
    if (!op || op.instant || op.modal) return null;
    const p = engineParams(op.id, params, mainInputs);
    for (const k of ['startSec', 'endSec', 'timeSec']) {
      if (typeof p[k] === 'string') p[k] = parseTimeInput(p[k]);
    }
    if (op.id === 'subtitle.extract') p.streamIndex = Number(params.streamIndex ?? 0);
    const engineOp = op.mapsTo || op.id;
    const validationResult = validateOperation(engineOp, p, mainInputs[0]?.probe);
    return { engineOp, params: p, validationResult };
  }, [op, params, mainInputs]);

  const plan = useMemo(() => {
    if (!resolved || !mainInputs.length) return null;
    const source = mainInputs[0].probe;
    if (!source) return null;
    const allProbes = op.id === 'video.merge' ? files.map((f) => f.probe).filter(Boolean) : undefined;
    return buildPlan(resolved.engineOp, resolved.params, source, { allProbes, gpuEncoders });
  }, [resolved, mainInputs, files, gpuEncoders]);

  const validation = useMemo(() => {
    if (!op) return { ok: false, reason: null };
    if (!mainInputs.length) {
      return { ok: false, reason: op.inputKind === 'subtitle' ? t('msg.needSubtitle') : op.inputKind === 'audio' ? t('msg.needAudio') : t('msg.needVideo') };
    }
    if (op.minFiles && mainInputs.length < op.minFiles) return { ok: false, reason: t('msg.needTwoForMerge') };
    if (op.extraInput && !extras[op.extraInput]?.length) {
      return { ok: false, reason: op.extraInput === 'audio' ? t('msg.needAudio') : t('msg.needSubtitle') };
    }
    if (op.id === 'subtitle.extract') {
      const video = mainInputs[0];
      if (!video.probe?.subtitleStreams?.length) return { ok: false, reason: t('common.noStreams') };
    }
    // Use shared validation for non-instant operations.
    if (!op.instant && resolved?.validationResult && !resolved.validationResult.ok) {
      return { ok: false, reason: t(resolved.validationResult.reason) };
    }
    if (params.videoBitrate != null && params.videoBitrate !== '') {
      const n = Number(params.videoBitrate);
      if (!isFinite(n) || n < 100 || n > 100000) return { ok: false, reason: t('param.bitrateRange', { min: 100, max: 100000 }) };
    }
    // Demanding GPU with no hardware encoder available is a hard error —
    // never silently fall back to CPU.
    if ((op.id === 'video.convert' || op.id === 'video.compress') &&
        params.hwStrategy === 'gpu' && !(gpuEncoders || []).length) {
      return { ok: false, reason: t('msg.gpuUnavailable') };
    }
    // Crop: when ratio is set, each file generates its own dimensions; only
    // custom dimensions need validation here.
    if (op.id === 'video.crop' && params.ratio === 'custom' &&
        (Number(params.w) <= 0 || Number(params.h) <= 0)) {
      return { ok: false, reason: t('msg.needDimensions') };
    }
    if (op.id === 'video.scale' && params.size === 'custom' &&
        (Number(params.width) <= 0 || Number(params.height) <= 0)) {
      return { ok: false, reason: t('msg.needDimensions') };
    }
    return { ok: true, reason: null };
  }, [op, mainInputs, extras, params, gpuEncoders, resolved, t]);

  // ------------------------------------------------------------- run / queue

  const runInstant = async () => {
    if (instantBusy) return;
    setInstantBusy(true);
    const p = engineParams(op.id, params, mainInputs);
    try {
      if (op.id === 'subtitle.convert') {
        for (const f of mainInputs) {
          const r = await bridge.subtitleConvert(f.path, p.targetFormat, sourceCharset);
          showToast(t('msg.subtitleDone', { file: r.outputPath.split(/[/\\]/).pop() }));
        }
      } else if (op.id === 'subtitle.shift') {
        const results = await bridge.subtitleShift(mainInputs.map((f) => f.path), p.offsetMs, Boolean(p.overwrite), sourceCharset);
        showToast(t('msg.subtitleDone', { file: results[0].outputPath.split(/[/\\]/).pop() }));
      } else if (op.id === 'subtitle.reencode') {
        const results = await bridge.subtitleReencode(mainInputs.map((f) => f.path), p.charset, Boolean(p.overwrite), sourceCharset);
        showToast(t('msg.subtitleDone', { file: results[0].outputPath.split(/[/\\]/).pop() }));
      }
    } catch (e) {
      showToast(String(e.message || e), 'error');
    } finally {
      setInstantBusy(false);
    }
  };

  const submit = async () => {
    if (!op || !validation.ok) return;
    if (op.instant) {
      await runInstant();
      return;
    }
    const extraPaths = op.extraInput ? (extras[op.extraInput] || []) : [];
    const specs = [];
    if (resolved.engineOp === 'video.merge') {
      specs.push({ op: resolved.engineOp, params: resolved.params, inputs: mainInputs.map((f) => f.path), outputDir });
    } else if (resolved.engineOp === 'subtitle.extract') {
      specs.push({ op: resolved.engineOp, params: resolved.params, inputs: [mainInputs[0].path], outputDir });
    } else if (op.id === 'video.crop' && params.ratio && params.ratio !== 'custom') {
      // Crop with preset ratio: generate per-file parameters
      for (const f of mainInputs) {
        const perFileParams = engineParams(op.id, params, [f]);
        specs.push({ op: resolved.engineOp, params: perFileParams, inputs: [f.path, ...extraPaths], outputDir });
      }
    } else {
      for (const f of mainInputs) {
        specs.push({ op: resolved.engineOp, params: resolved.params, inputs: [f.path, ...extraPaths], outputDir });
      }
    }
    try {
      const added = await bridge.addJobs(specs);
      showToast(t('msg.jobsAdded', { n: added.length }));
    } catch (e) {
      showToast(String(e.message || e), 'error');
    }
  };

  // ------------------------------------------------------------------ render

  const shortcuts = section === 'video'
    ? [{ target: 'audio', key: 'shortcut.openAudio' }, { target: 'subtitle', key: 'shortcut.openSubtitle' }]
    : [{ target: 'video', key: 'shortcut.openVideo' }];

  return (
    <div className="page-inner">
      <div className="page-header">
        <h1><span className={`domain-dot ${section}`} aria-hidden="true" />{t(`nav.${section}`)}</h1>
        <p>{t('app.tagline')}</p>
      </div>

      <div className="section-label">{t('extra.mainInput')}</div>
      <DropZone onFiles={addFiles} section={section} />
      <div className="action-bar" style={{ marginTop: 10 }}>
        <button className="btn btn-secondary" onClick={browse}>
          <Icon name="plus" size={13} /> {t('common.addFiles')}
        </button>
        {files.length > 0 && (
          <button className="btn btn-ghost" onClick={() => setFiles([])}>{t('common.clearAll')}</button>
        )}
        {files.length > 0 && (
          <span className="action-note">
            {files.length} {section === 'video' ? t('common.videoFile') : section === 'audio' ? t('common.audioFile') : t('common.subtitleFile')}
            {op?.batch && mainInputs.length > 1 ? ` · ${t('common.batchNote')}` : ''}
          </span>
        )}
      </div>

      <FileList
        files={files}
        onRemove={(path) => setFiles((prev) => prev.filter((f) => f.path !== path))}
        onReorder={op?.reorderable ? (next) => setFiles(next) : null}
        reorderable={Boolean(op?.reorderable)}
      />

      <div className="section-label" style={{ marginTop: 24 }}>{t(`nav.${section}`)}</div>
      <OperationGrid ops={ops} selected={selectedOp} onSelect={selectOp} />

      {op && !op.modal && (
        <>
          <div className="section-label">{t(op.id)}</div>
          <ParamPanel op={op} params={params} setParams={setParams} files={files} gpuEncoders={gpuEncoders} />

          {op.extraInput && (
            <ExtraInput
              kind={op.extraInput}
              multiple={op.extraMultiple}
              paths={extras[op.extraInput]}
              setPaths={(paths) => setExtras((prev) => ({ ...prev, [op.extraInput]: paths }))}
            />
          )}

          {op.instant && (op.id === 'subtitle.convert' || op.id === 'subtitle.shift' || op.id === 'subtitle.reencode') && (
            <div className="card param-panel">
              <div className="param-grid">
                <div className="param-field">
                  <span className="param-label">{t('param.sourceCharset')}</span>
                  <select
                    className="field"
                    value={sourceCharset}
                    aria-label={t('param.sourceCharset')}
                    onChange={(e) => setSourceCharset(e.target.value)}
                  >
                    <option value="auto">{t('param.autoDetect')}</option>
                    <option value="gbk">GBK</option>
                    <option value="gb2312">GB2312</option>
                    <option value="big5">Big5</option>
                    <option value="shift_jis">Shift-JIS</option>
                    <option value="euc-kr">EUC-KR</option>
                    <option value="iso-8859-1">ISO-8859-1</option>
                    <option value="windows-1252">Windows-1252</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {!op.instant && plan && <PlanSummary plan={plan} source={mainInputs[0]?.probe} />}

          <div className="action-bar">
            <button
              className={`btn ${op.instant ? 'btn-instant' : 'btn-primary'}`}
              disabled={!validation.ok || instantBusy}
              title={validation.reason || undefined}
              onClick={submit}
            >
              <Icon name={op.instant ? 'bolt' : 'play'} size={13} />
              {op.instant
                ? (instantBusy ? t('common.processing') : t('common.runNow'))
                : mainInputs.length > 1 && op.batch
                  ? t('common.addNToQueue', { n: mainInputs.length })
                  : t('common.addToQueue')}
            </button>
            {!validation.ok && validation.reason && (
              <span className="action-note">{validation.reason}</span>
            )}
            {!op.instant && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const dir = await bridge.pickDirectory();
                  if (dir) setOutputDir(dir);
                }}
              >
                <Icon name="folder" size={13} />
                {outputDir ? outputDir.split(/[/\\]/).pop() : t('common.sameFolder')}
              </button>
            )}
          </div>
        </>
      )}

      <div className="action-bar shortcut-bar">
        {shortcuts.map((s) => (
          <button key={s.target} className="btn btn-ghost" onClick={() => onTransfer(s.target)}>
            <Icon name={s.target === 'audio' ? 'audio' : s.target === 'subtitle' ? 'subtitle' : 'video'} size={13} />
            {t(s.key)}
          </button>
        ))}
      </div>

      {metaFile && <MetadataModal file={metaFile} onClose={() => setMetaFile(null)} />}

      {toast && <div className={`toast show ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
