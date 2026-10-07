import { useI18n } from '../i18n';

export function Segmented({ options, value, onChange, ariaLabel }) {
  const { t } = useI18n();
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const label = typeof o === 'object'
          ? (o.labelKey ? t(o.labelKey) : o.label)
          : o;
        return (
          <button
            key={v} type="button"
            className={value === v ? 'active' : ''}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Labeled({ labelKey, hint, children, wide }) {
  const { t } = useI18n();
  return (
    <div className={`param-field${wide ? ' wide' : ''}`}>
      {labelKey && <span className="param-label">{t(labelKey)}</span>}
      {children}
      {hint && <span className="param-hint">{typeof hint === 'string' && hint.includes('.') ? t(hint) : hint}</span>}
    </div>
  );
}

export function SliderField({ label, value, min, max, step, onChange, format, hint }) {
  const { t } = useI18n();
  const display = format === 'x' ? `${value.toFixed(2)}×`
    : format === 'dB' ? `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
    : format ? `${value}${format}`
    : String(value);
  return (
    <div className="param-field wide">
      {label && <span className="param-label">{t(label)}</span>}
      <div className="slider-row">
        <input
          type="range" min={min} max={max} step={step} value={value}
          aria-label={label ? t(label) : undefined}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider-value">{display}</span>
      </div>
      {hint && <span className="param-hint">{hint}</span>}
    </div>
  );
}

export function SwitchField({ label, value, onChange }) {
  const { t } = useI18n();
  const text = label ? t(label) : undefined;
  return (
    <div className="switch-row">
      <button
        type="button"
        className={`switch${value ? ' on' : ''}`}
        role="switch" aria-checked={value} aria-label={text}
        onClick={() => onChange(!value)}
      />
      {text && <span className="param-label">{text}</span>}
    </div>
  );
}

export function SelectField({ label, options, value, onChange, optionLabelKeys, ariaLabel }) {
  const { t } = useI18n();
  const labelFor = (o) => {
    if (optionLabelKeys && optionLabelKeys[o] != null) return t(optionLabelKeys[o]);
    return o;
  };
  return (
    <div className="param-field">
      {label && <span className="param-label">{t(label)}</span>}
      <select
        className="field" value={String(value)}
        aria-label={label ? t(label) : ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          return <option key={String(v)} value={String(v)}>{labelFor(v)}</option>;
        })}
      </select>
    </div>
  );
}

export function NumberField({ label, value, onChange, min, max, step, placeholder }) {
  const { t } = useI18n();
  return (
    <div className="param-field">
      {label && <span className="param-label">{t(label)}</span>}
      <input
        className="field" type="number" value={value ?? ''}
        min={min} max={max} step={step ?? 1}
        placeholder={placeholder}
        aria-label={label ? t(label) : undefined}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    </div>
  );
}

// Bitrate input: kbps number with unit suffix and range validation.
// The engine always receives kbps; "1500" can never mean 1500 bit/s.
export function BitrateField({ label, value, onChange, min = 100, max = 100000 }) {
  const { t } = useI18n();
  const n = Number(value);
  const invalid = value !== '' && value != null && (!isFinite(n) || n < min || n > max);
  return (
    <div className="param-field">
      {label && <span className="param-label">{t(label)} <span className="unit">({t('unit.kbps')})</span></span>}
      <div className={`bitrate-row${invalid ? ' invalid' : ''}`}>
        <input
          className="field" type="number" value={value ?? ''}
          min={min} max={max} step={1}
          aria-label={label ? `${t(label)} (${t('unit.kbps')})` : undefined}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <span className="unit-suffix">{t('unit.kbps')}</span>
      </div>
      {invalid && <span className="param-hint error">{t('param.bitrateRange', { min, max })}</span>}
    </div>
  );
}

export function TextField({ label, value, onChange, placeholder }) {
  const { t } = useI18n();
  return (
    <div className="param-field">
      {label && <span className="param-label">{t(label)}</span>}
      <input
        className="field wide" type="text" value={value ?? ''} placeholder={placeholder}
        aria-label={label ? t(label) : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function TimeField({ label, value, onChange }) {
  const { t } = useI18n();
  return (
    <div className="param-field">
      <span className="param-label">{t(label)}</span>
      <input
        className="field" type="text" placeholder="0:00 / 12.5"
        value={value == null ? '' : String(value)}
        aria-label={t(label)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Four user-facing quality presets (normal mode of format conversion).
export function PresetCards({ value, onChange }) {
  const { t } = useI18n();
  const presets = ['compat', 'balanced', 'quality', 'small'];
  return (
    <div className="preset-grid" role="radiogroup" aria-label={t('param.quality')}>
      {presets.map((p) => (
        <button
          key={p} type="button"
          className={`preset-card${value === p ? ' selected' : ''}`}
          role="radio" aria-checked={value === p}
          onClick={() => onChange(p)}
        >
          <span className="preset-name">{t(`preset.${p}`)}</span>
          <span className="preset-desc">{t(`preset.${p}.desc`)}</span>
        </button>
      ))}
    </div>
  );
}
