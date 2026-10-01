import { useEffect, useState } from 'react';
import { useI18n, LANGUAGES } from '../i18n';
import { bridge, isElectron } from '../lib/bridge';
import { Icon } from '../components/icons';

export default function SettingsPage({ settings, setSettings }) {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [ffmpegPath, setFfmpegPath] = useState('');

  useEffect(() => { bridge.appInfo().then(setInfo); }, []);

  const update = async (patch) => {
    const next = await bridge.setSettings(patch);
    setSettings(next);
  };

  const pickOutputDir = async () => {
    const dir = await bridge.pickDirectory();
    if (dir) update({ outputDir: dir });
  };

  const pickFfmpeg = async () => {
    const picked = await bridge.openFiles('any');
    if (picked?.length) {
      setFfmpegPath(picked[0]);
      update({ ffmpegPath: picked[0] });
    }
  };

  return (
    <div className="page-inner">
      <div className="page-header">
        <h1>{t('settings.title')}</h1>
        <p>{t('app.tagline')}</p>
      </div>

      <div className="card settings-group">
        <h2>{t('settings.general')}</h2>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.language')}</div>
            <div className="setting-hint">{t('settings.languageHint')}</div>
          </div>
          <select className="field" value={settings.language || 'system'} onChange={(e) => update({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.value === 'system' ? t('settings.systemLanguage') : l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.outputDir')}</div>
            <div className="setting-hint">{t('settings.outputDirHint')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {settings.outputDir && <span className="path-value">{settings.outputDir}</span>}
            <button className="btn btn-secondary" onClick={pickOutputDir}>{t('common.choose')}</button>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.preventSleep')}</div>
            <div className="setting-hint">{t('settings.preventSleepHint')}</div>
          </div>
          <button
            type="button"
            className={`switch${settings.preventSleep ? ' on' : ''}`}
            role="switch"
            aria-checked={Boolean(settings.preventSleep)}
            aria-label={t('settings.preventSleep')}
            onClick={() => update({ preventSleep: !settings.preventSleep })}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.concurrency')}</div>
            <div className="setting-hint">{t('settings.concurrencyHint')}</div>
          </div>
          <div className="segmented">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                className={String(settings.concurrency || 1) === String(n) ? 'active' : ''}
                onClick={() => update({ concurrency: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card settings-group">
        <h2>{t('settings.engine')}</h2>
        <div className="setting-row">
          <div>
            <div className="setting-label">{t('settings.ffmpeg')}</div>
            <div className="setting-hint">{t('settings.bundledHint')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="path-value">{ffmpegPath || (info?.ffmpegPath || t('settings.bundled'))}</span>
            <button className="btn btn-secondary" onClick={pickFfmpeg}>{t('common.choose')}</button>
          </div>
        </div>
      </div>

      <div className="card settings-group">
        <h2>{t('settings.about')}</h2>
        <dl className="about-grid">
          <dt>{t('settings.version')}</dt><dd>{info?.version || '1.0.0'}</dd>
          <dt>Electron</dt><dd>{info?.electron || '—'}</dd>
          <dt>FFmpeg</dt><dd>{info ? '6.0' : '—'}</dd>
        </dl>
        <div style={{ marginTop: 12 }}>
          <div className="setting-label">{t('settings.references')}</div>
          <div style={{ marginTop: 6 }}>
            {['LosslessCut', 'HandBrake', 'Shutter Encoder', 'Subtitle Edit'].map((r) => (
              <span key={r} className="ref-pill">{r}</span>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="setting-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="bolt" size={13} /> {t('settings.aiFuture')}
          </div>
          <div className="setting-hint" style={{ marginTop: 4 }}>{t('settings.aiFutureText')}</div>
        </div>
        <div className="setting-hint" style={{ marginTop: 12 }}>{t('settings.gplNote')}</div>
        {!isElectron && (
          <div className="setting-hint" style={{ marginTop: 8, color: 'var(--yellow-deep)' }}>
            ⚠︎ Browser preview mode — start the Electron app for real processing.
          </div>
        )}
      </div>
    </div>
  );
}
