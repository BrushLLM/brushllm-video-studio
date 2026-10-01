import { useState } from 'react';
import { useI18n } from '../i18n';
import { formatDuration, formatSize, formatBitrate } from '../lib/format';
import { Icon } from './icons';

export default function MetadataModal({ file, onClose }) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);
  const s = file.probe || {};
  const raw = file.raw || {};

  const typeLabel = { video: t('nav.video'), audio: t('nav.audio'), subtitle: t('nav.subtitle') };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('meta.title')} — {file.name}</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="section-label" style={{ margin: '0 0 10px' }}>{t('meta.general')}</div>
          <dl className="meta-grid">
            <dt>{t('meta.formatName')}</dt><dd>{s.formatName || '—'}</dd>
            <dt>{t('common.duration')}</dt><dd>{formatDuration(s.durationSec)}</dd>
            <dt>{t('common.size')}</dt><dd>{formatSize(s.size)}</dd>
            <dt>{t('common.bitrate')}</dt><dd>{formatBitrate(s.bitrate)}</dd>
            {s.video && <>
              <dt>{t('common.resolution')}</dt><dd>{s.video.width}×{s.video.height}{s.video.rotation ? ` · ${s.video.rotation}°` : ''}</dd>
              <dt>{t('common.fps')}</dt><dd>{s.video.fps}</dd>
              <dt>{t('common.codec')}</dt><dd>{s.video.codec}</dd>
            </>}
            {s.audio && <>
              <dt>{t('meta.sampleRate')}</dt><dd>{s.audio.sampleRate ? `${s.audio.sampleRate} Hz` : '—'}</dd>
              <dt>{t('meta.channels')}</dt><dd>{s.audio.channels}</dd>
              <dt>{t('common.codec')}</dt><dd>{s.audio.codec}</dd>
            </>}
          </dl>

          <div className="section-label">{t('meta.streams')}</div>
          <table className="stream-table">
            <thead>
              <tr><th>#</th><th>{t('meta.type')}</th><th>{t('common.codec')}</th><th>{t('common.resolution')}</th><th>{t('common.bitrate')}</th></tr>
            </thead>
            <tbody>
              {(raw.streams || []).map((st) => (
                <tr key={st.index}>
                  <td>{st.index}</td>
                  <td>{typeLabel[st.codec_type] || st.codec_type}</td>
                  <td>{st.codec_name}{st.codec_name !== st.codec_long_name ? ` (${st.codec_long_name})` : ''}</td>
                  <td>{st.width ? `${st.width}×${st.height}` : '—'}</td>
                  <td>{st.bit_rate ? formatBitrate(+st.bit_rate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="action-bar">
            <button className="btn btn-secondary" onClick={() => setShowRaw(!showRaw)}>
              {t('meta.showRaw')}
            </button>
          </div>
          {showRaw && <pre className="raw-json">{JSON.stringify(raw, null, 2)}</pre>}
        </div>
      </div>
    </div>
  );
}
