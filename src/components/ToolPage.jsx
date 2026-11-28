import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { fileKindOf, filterForSection, inputFilesForOp } from '../../shared/media.mjs';
import { buildPlan } from '../../shared/plan.mjs';
import { resolveOperation } from '../../shared/resolve.mjs';
import { opsForSection, defaultParams, engineParams } from '../ops';
import { parseTimeInput } from '../lib/format';
import SourceFiles from './SourceFiles';
import OperationGrid from './OperationGrid';
import ParamPanel from './ParamPanel';
import ToolFooter from './ToolFooter';
import ExtraInput from './ExtraInput';
import MetadataModal from './MetadataModal';
import { PlanSummary } from './MediaSummary';
import VideoPreview from './VideoPreview';
import WorkspacePane from './WorkspacePane';
import { Icon } from './icons';

export default memo(function ToolPage({ section, files, setFiles, onTransfer, platform, gpuEncoders, defaultOutputDir = '', drafts, sidebarTools }) {
  const { t } = useI18n();
  const ops = useMemo(() => opsForSection(section), [section]);
  const [selectedOp, setSelectedOp] = useState(() => drafts[section]?.selectedOp || ops[0].id);
  const [params, setParams] = useState(() => drafts[section]?.params || defaultParams(ops[0]));
  const [extras, setExtras] = useState(() => drafts[section]?.extras || {});
  const [sourceCharset, setSourceCharset] = useState(() => drafts[section]?.sourceCharset || 'auto');
  const [outputDir, setOutputDir] = useState(() => drafts[section]?.outputDir ?? null);
  const [clearedFiles, setClearedFiles] = useState(() => drafts[section]?.clearedFiles || []);
  const [instantBusy, setInstantBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const submission = useRef(false);
  const [toast, setToast] = useState(null);
  const [metaFile, setMetaFile] = useState(null);
  const [view, setView] = useState('preview');
  const queueButton = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    drafts[section] = { selectedOp, params, extras, sourceCharset, outputDir, clearedFiles };
  }, [section, drafts, selectedOp, params, extras, sourceCharset, outputDir, clearedFiles]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const op = ops.find((o) => o.id === selectedOp);

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
      const fresh = [...new Set(accepted)]
        .filter((p) => !known.has(p))
        .map((p) => ({ path: p, name: p.split(/[/\\]/).pop(), kind: fileKindOf(p), probing: false, probe: null, raw: null, requestToken }));
      return [...prev, ...fresh];
    });
  };

  // Probe media files asynchronously once added. Use requestToken to avoid
  // perpetual probing when files are transferred between pages.
  useEffect(() => {
    const toProbe = new Set(files.filter((f) => (f.kind === 'video' || f.kind === 'audio') && !f.probe && !f.probing && !f.probeFailed));
    if (!toProbe.size) return;
    setFiles((prev) => prev.map((f) => (toProbe.has(f) ? { ...f, probing: true } : f)));
    toProbe.forEach(async (f) => {
      const token = f.requestToken;
      try {
        const { raw, summary } = await bridge.probeFile(f.path);
        setFiles((prev) => prev.map((x) => (x.path === f.path && x.requestToken === token ? { ...x, probing: false, probe: summary, raw } : x)));
      } catch {
        setFiles((prev) => prev.map((x) => (x.path === f.path && x.requestToken === token ? { ...x, probing: false, probeFailed: true } : x)));
      }
    });
  }, [files, setFiles]);

  // ------------------------------------------------------------ op selection

  const selectOp = (id) => {
    if (id === selectedOp) return;
    const next = ops.find((o) => o.id === id);
    if (next.modal) {
      const first = inputFilesForOp(files, next.inputKind)[0];
      if (!first) { showToast(t('msg.needFiles'), 'error'); return; }
      setMetaFile(first);
      return;
    }
    setSelectedOp(id);
    setParams(defaultParams(next));
    setExtras({});
    setSourceCharset('auto');
    setAddedCount(0);
  };

  // ------------------------------------------------------- plan + validation

  const mainInputs = useMemo(() => inputFilesForOp(files, op.inputKind), [files, op]);

  const resolved = useMemo(() => {
    if (op.instant) return null;
    const p = engineParams(op.id, params, mainInputs);
    if (op.extraInput === 'subtitle') p.sourceCharset = sourceCharset;
    for (const k of ['startSec', 'endSec', 'timeSec']) {
      if (typeof p[k] === 'string') p[k] = parseTimeInput(p[k]);
    }
    if (op.id === 'subtitle.extract') p.streamIndex = Number(params.streamIndex ?? 0);
    const engineOp = op.mapsTo || op.id;
    const allProbes = engineOp === 'video.merge' && mainInputs.length > 1 && mainInputs.every((file) => file.probe)
      ? mainInputs.map((file) => file.probe) : undefined;
    const decision = resolveOperation(engineOp, p, mainInputs[0]?.probe, { allProbes, gpuEncoders });
    return { engineOp, params: p, allProbes, decision };
  }, [op, params, mainInputs, sourceCharset, gpuEncoders]);

  const plan = useMemo(() => {
    const source = mainInputs[0]?.probe;
    if (!resolved || !source || resolved.decision.error) return null;
    if (op.id === 'video.merge' && !resolved.allProbes) return null;
    const { encoding, merge } = resolved.decision;
    return buildPlan(resolved.engineOp, resolved.params, source, { allProbes: resolved.allProbes, encoding, merge });
  }, [op.id, resolved, mainInputs]);

  const validation = useMemo(() => {
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
    if (op.id === 'video.merge' && !resolved.allProbes) {
      return { ok: false, reason: t(mainInputs.some((file) => file.probeFailed) ? 'msg.probeFailed' : 'common.probing') };
    }
    const issue = resolved?.decision.issues?.[0];
    if (issue) return { ok: false, reason: t(`validation.${issue.code}`, issue.params) };
    const error = resolved?.decision.error;
    if (error) {
      if (error === 'gpu-unavailable') return { ok: false, reason: t('msg.gpuUnavailable') };
      if (error === 'gpu-container-conflict') return { ok: false, reason: t('validation.gpu-container-conflict') };
      return { ok: false, reason: error };
    }
    return { ok: true, reason: null };
  }, [op, mainInputs, extras, resolved, t]);

  // ------------------------------------------------------------- run / queue

  const runInstant = async () => {
    if (instantBusy) return;
    setInstantBusy(true);
    try {
      const results = await bridge.processSubtitles({
        op: op.id, inputs: mainInputs.map((file) => file.path), params: engineParams(op.id, params, mainInputs), sourceCharset
      });
      const failures = results.filter((result) => result.error);
      if (failures.length) {
        const [first] = failures;
        const message = t('msg.subtitleBatchFailed', {
          done: results.length - failures.length, failed: failures.length, file: first.input.split(/[/\\]/).pop()
        });
        showToast(`${message} ${first.error}`, 'error');
      } else if (results.length === 1) {
        showToast(t('msg.subtitleDone', { file: results[0].outputPath.split(/[/\\]/).pop() }));
      } else {
        showToast(t('msg.subtitleBatchDone', { n: results.length }));
      }
    } catch (e) {
      showToast(String(e.message || e), 'error');
    } finally {
      setInstantBusy(false);
    }
  };

  const submit = async () => {
    if (!validation.ok || submission.current) return;
    if (op.instant) {
      submission.current = true;
      try { await runInstant(); } finally { submission.current = false; }
      return;
    }
    submission.current = true;
    setSubmitting(true);
    setAddedCount(0);
    try {
      const extraPaths = extras[op.extraInput] || [];
      const makeJob = (inputs, jobParams = resolved.params) => ({ op: resolved.engineOp, params: jobParams, inputs, outputDir });
      const cropToRatio = op.id === 'video.crop' && params.ratio && params.ratio !== 'custom';
      let specs;
      if (resolved.engineOp === 'video.merge') {
        specs = [makeJob(mainInputs.map((f) => f.path))];
      } else if (resolved.engineOp === 'subtitle.extract') {
        specs = [makeJob([mainInputs[0].path])];
      } else {
        specs = mainInputs.map((file) => makeJob(
          [file.path, ...extraPaths],
          cropToRatio ? engineParams(op.id, params, [file]) : resolved.params
        ));
      }
      const added = await bridge.addJobs(specs);
      setAddedCount(added.length);
    } catch (e) {
      showToast(String(e.message || e), 'error');
    } finally {
      submission.current = false;
      setSubmitting(false);
    }
  };

  const batchSize = op.batch ? mainInputs.length : 0;
  let submitLabel = t('common.addToQueue');
  if (submitting) submitLabel = t('common.preparing');
  else if (op.instant) submitLabel = t(instantBusy ? 'common.processing' : 'common.runNow');
  else if (batchSize > 1) submitLabel = t('common.addNToQueue', { n: batchSize });

  const output = op.instant ? null : {
    outputDir, defaultOutputDir, setOutputDir, onError: (message) => showToast(message, 'error')
  };
  const previewFile = files.find((file) => file.probe?.video);
  const openQueue = () => {
    setView('queue');
    queueButton.current?.focus();
  };

  return (
    <div className="workbench">
      <div className="workbench-controls">
        <div className="controls-scroll">
          <OperationGrid ops={ops} selected={selectedOp} onSelect={selectOp} sidebar={sidebarTools} />
          <section className="inspector" aria-labelledby="inspector-title">
            <header className="inspector-header">
              <span className="inspector-icon"><Icon name={op.icon} size={22} /></span>
              <div>
                <h2 id="inspector-title">{t(op.id)}</h2>
                <p>{t(`${op.id}.desc`)}</p>
              </div>
            </header>

            <ParamPanel op={op} params={params} setParams={setParams} files={files} gpuEncoders={gpuEncoders}>
              {(op.instant || op.extraInput === 'subtitle') && (
                <label className="param-field">
                  <span className="param-label">{t('param.sourceCharset')}</span>
                  <select className="field" value={sourceCharset} onChange={(e) => setSourceCharset(e.target.value)}>
                    <option value="auto">{t('param.autoDetect')}</option>
                    <option value="gbk">GBK</option>
                    <option value="gb2312">GB2312</option>
                    <option value="big5">Big5</option>
                    <option value="shift_jis">Shift-JIS</option>
                    <option value="euc-kr">EUC-KR</option>
                    <option value="iso-8859-1">ISO-8859-1</option>
                    <option value="windows-1252">Windows-1252</option>
                  </select>
                </label>
              )}
            </ParamPanel>

            {op.extraInput && (
              <ExtraInput
                kind={op.extraInput}
                multiple={op.extraMultiple}
                paths={extras[op.extraInput]}
                setPaths={(paths) => setExtras((prev) => ({ ...prev, [op.extraInput]: paths }))}
              />
            )}
          </section>
        </div>
        <ToolFooter
          output={output} submitLabel={submitLabel} disabled={!validation.ok || instantBusy || submitting}
          reason={validation.reason} notice={toast} onSubmit={submit} addedCount={addedCount} onOpenQueue={view === 'preview' ? openQueue : undefined}
        />
      </div>
      <WorkspacePane section={section} platform={platform} view={view} onViewChange={setView} queueButton={queueButton}>
        <SourceFiles
          section={section} files={files} setFiles={setFiles} onAdd={addFiles}
          onTransfer={onTransfer} reorderable={Boolean(op.reorderable)}
          clearedFiles={clearedFiles} setClearedFiles={setClearedFiles}
        />
        {(previewFile || plan) && <div className="preview-grid" data-comparison={Boolean(previewFile && plan)}>
          {previewFile && <VideoPreview key={`${previewFile.path}:${previewFile.requestToken}`} file={previewFile} />}
          {plan && <PlanSummary
            plan={plan} source={mainInputs[0].probe} fileName={mainInputs[0].name} sampledBatch={batchSize > 1}
          />}
        </div>}
      </WorkspacePane>
      {metaFile && <MetadataModal file={metaFile} onClose={() => setMetaFile(null)} />}
    </div>
  );
});
