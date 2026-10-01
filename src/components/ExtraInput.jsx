import { useI18n } from '../i18n';
import { Icon } from './icons';
import { bridge } from '../lib/bridge';

// Secondary input (audio / subtitle) — visually and semantically separate
// from the main input file list.
export default function ExtraInput({ kind, multiple, paths, setPaths }) {
  const { t } = useI18n();
  const labelKey = kind === 'audio' ? 'extra.audioInput' : 'extra.subtitleInput';

  const pick = async () => {
    const picked = await bridge.openFiles(kind === 'audio' ? 'audio' : 'subtitle');
    if (picked?.length) {
      setPaths(multiple ? picked : [picked[0]]);
    }
  };

  return (
    <div className="card extra-input-card">
      <div className="extra-input-head">
        <Icon name={kind === 'audio' ? 'audio' : 'subtitle'} size={15} />
        <span className="param-label">{t(labelKey)}</span>
      </div>
      {paths?.length ? (
        <div className="extra-input-list">
          {paths.map((p) => (
            <div key={p} className="extra-input-row">
              <span className="file-name">{p.split(/[/\\]/).pop()}</span>
              <button
                className="icon-btn" title={t('common.remove')}
                aria-label={`${t('common.remove')} ${p.split(/[/\\]/).pop()}`}
                onClick={() => setPaths(paths.filter((x) => x !== p))}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost" onClick={pick}>{t('common.addFiles')}</button>
        </div>
      ) : (
        <button className="btn btn-secondary extra-pick" onClick={pick}>
          <Icon name="plus" size={13} /> {t('common.choose')}
        </button>
      )}
    </div>
  );
}
