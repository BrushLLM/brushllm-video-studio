import { useI18n } from '../i18n';
import {
  Segmented, SelectField, NumberField, TextField, TimeField,
  SliderField, SwitchField, BitrateField, PresetCards
} from './controls';

const CODEC_LABELS = {
  h264: 'H.264',
  hevc: 'H.265 (HEVC)',
  vp9: 'VP9',
  av1: 'AV1',
  h264_videotoolbox: 'H.264 (GPU)',
  hevc_videotoolbox: 'H.265 (GPU)',
  h264_nvenc: 'H.264 (GPU)',
  hevc_nvenc: 'H.265 (GPU)',
  h264_qsv: 'H.264 (GPU)',
  hevc_qsv: 'H.265 (GPU)',
  h264_amf: 'H.264 (GPU)',
  hevc_amf: 'H.265 (GPU)'
};

const GPU_SET = new Set(Object.keys(CODEC_LABELS).filter((k) => k.includes('_')));

// Schema-driven parameter editor.
export default function ParamPanel({ op, params, setParams, files, gpuEncoders = [] }) {
  const { t } = useI18n();
  const firstVideo = files.find((f) => f.kind === 'video');
  const subStreams = firstVideo?.probe?.subtitleStreams || [];
  const advanced = Boolean(params.advanced);

  const set = (key, value) => setParams((prev) => ({ ...prev, [key]: value }));

  const codecOptions = ['h264', 'hevc', 'vp9', 'av1', ...gpuEncoders];

  const visible = op.params.filter((p) => {
    if (p.type === 'preset' && advanced) return false; // presets are the normal mode
    if (p.advanced && !advanced) return false;
    if (p.showIf && !p.showIf(params)) return false;
    return true;
  });

  const renderParam = (p) => {
    const labelKey = p.labelKey || `param.${p.key}`;
    switch (p.type) {
      case 'preset':
        return (
          <div key={p.key} className="param-field wide">
            <span className="param-label">{t('param.quality')}</span>
            <PresetCards value={params[p.key] ?? p.default} onChange={(v) => set(p.key, v)} />
          </div>
        );
      case 'select':
        return (
          <SelectField
            key={p.key} label={labelKey} options={p.options}
            value={params[p.key] ?? p.default}
            optionLabelKeys={p.optionLabelKeys}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'codec':
        return (
          <div key={p.key} className="param-field">
            <span className="param-label">{t('param.videoCodec')}</span>
            <select
              className="field"
              value={params[p.key] ?? p.default}
              aria-label={t('param.videoCodec')}
              onChange={(e) => {
                const v = e.target.value;
                set(p.key, v);
                // GPU encoders are bitrate-driven; switch modes honestly.
                if (GPU_SET.has(v) && params.mode === 'crf') set('mode', 'bitrate');
              }}
            >
              {codecOptions.map((c) => (
                <option key={c} value={c}>{CODEC_LABELS[c] || c}</option>
              ))}
            </select>
            {GPU_SET.has(params[p.key]) && (
              <span className="param-hint gpu">{t('plan.gpuBitrateOnly')}</span>
            )}
          </div>
        );
      case 'segmented':
        return (
          <div key={p.key} className={`param-field${p.hint ? ' wide' : ''}`}>
            <span className="param-label">{t(labelKey)}</span>
            <Segmented
              options={p.options}
              value={params[p.key] ?? p.default}
              onChange={(v) => set(p.key, v)}
              ariaLabel={t(labelKey)}
            />
            {p.hint && <span className="param-hint">{t(p.hint)}</span>}
          </div>
        );
      case 'slider':
        return (
          <SliderField
            key={p.key} label={p.hint ? null : labelKey} hint={p.hint ? t('param.crfHint') : null}
            min={p.min} max={p.max} step={p.step} format={p.format}
            value={params[p.key] ?? p.default}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'bitrate':
        return (
          <BitrateField
            key={p.key} label={labelKey}
            value={params[p.key] ?? p.default}
            min={p.min} max={p.max}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'number':
        return (
          <NumberField
            key={p.key} label={labelKey} min={p.min} max={p.max} step={p.step}
            value={params[p.key] ?? p.default}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'text':
        return (
          <TextField
            key={p.key} label={labelKey} placeholder={p.placeholder}
            value={params[p.key] ?? ''}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'time':
        return (
          <TimeField
            key={p.key} label={labelKey}
            value={params[p.key]}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'switch':
        return (
          <div key={p.key} className="param-field">
            <SwitchField
              label={labelKey}
              value={Boolean(params[p.key])}
              onChange={(v) => set(p.key, v)}
            />
          </div>
        );
      case 'ratio':
        return (
          <SelectField
            key={p.key} label={labelKey}
            options={['custom', '16:9', '4:3', '1:1', '9:16']}
            value={params[p.key] ?? 'custom'}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'size':
        return (
          <SelectField
            key={p.key} label="param.ratio"
            options={['1080p', '720p', '480p', '360p', 'custom']}
            value={params[p.key] ?? '720p'}
            onChange={(v) => set(p.key, v)}
          />
        );
      case 'stream': {
        const hasImageSubs = subStreams.some((s) => /pgs|dvd|dvbsub|hdmv/.test(s.codec));
        return (
          <div key={p.key} className="param-field wide">
            <span className="param-label">{t('param.stream')}</span>
            {subStreams.length ? (
              <select
                className="field"
                value={String(params[p.key] ?? 0)}
                aria-label={t('param.stream')}
                onChange={(e) => set(p.key, Number(e.target.value))}
              >
                {subStreams.map((s, i) => (
                  <option key={s.index} value={i}>
                    #{i} · {s.codec}{s.language ? ` · ${s.language}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="param-hint">{t('common.noStreams')}</span>
            )}
            {hasImageSubs && <span className="param-hint">{t('common.imageSubs')}</span>}
          </div>
        );
      }
      default:
        return null;
    }
  };

  // Honest notes about containers that force different encoders.
  const containerNote =
    op.id === 'video.convert' && advanced
      ? params.container === 'webm' ? t('plan.forcedWebm')
        : params.container === 'avi' ? t('plan.forcedAvi')
        : null
      : null;

  return (
    <div className="card param-panel">
      <div className="param-grid">
        {visible.map(renderParam)}
      </div>
      {containerNote && <div className="param-note">{containerNote}</div>}
    </div>
  );
}
