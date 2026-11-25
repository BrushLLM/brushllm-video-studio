import { useI18n } from '../i18n';
import { Icon } from './icons';
import { formatDuration, formatSize, formatBitrate } from '../lib/format';

const KIND_ICON = { video: 'video', audio: 'audio', subtitle: 'subtitle' };

export default function FileList({ files, onRemove, onReorder, reorderable, onRetry }) {
  const { t } = useI18n();
  if (!files.length) return null;

  const move = (i, dir) => {
    if (!onReorder) return;
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item);
    onReorder(next);
  };

  return (
    <ul className="file-list">
      {files.map((f, i) => (
        <li key={f.path} className={`file-row${f.probeFailed ? ' warning' : ''}`}>
          <div className={`file-icon ${f.kind}`}>
            <Icon name={KIND_ICON[f.kind] || 'doc'} size={17} />
          </div>
          <div className="file-info">
            <div className="file-name" title={f.path}>{f.name}</div>
            <div className="file-meta">
              {f.probing
                ? <span>{t('common.probing')}</span>
                : f.probeFailed
                  ? <span className="file-meta-warning"><Icon name="warning" size={12} />{t('msg.probeFailed')}</span>
                  : f.probe
                    ? <>
                        {f.probe.video && <span>{f.probe.video.width}×{f.probe.video.height}</span>}
                        {f.probe.durationSec > 0 && <span>{formatDuration(f.probe.durationSec)}</span>}
                        {f.probe.video?.codec && <span>{f.probe.video.codec}</span>}
                        {f.probe.audio?.codec && <span>{f.probe.audio.codec}</span>}
                        {f.probe.bitrate > 0 && <span>{formatBitrate(f.probe.bitrate)}</span>}
                        {f.probe.size > 0 && <span>{formatSize(f.probe.size)}</span>}
                      </>
                    : <span>{f.size > 0 ? formatSize(f.size) : (f.name.match(/\.([^.]+)$/)?.[1] || '').toUpperCase()}</span>}
            </div>
          </div>
          <div className="file-actions">
            {f.probeFailed && onRetry && (
              <button type="button" className="icon-btn" title={t('common.retry')} aria-label={`${t('common.retry')} ${f.name}`} onClick={() => onRetry(f.path)}><Icon name="rotate" size={15} /></button>
            )}
            {reorderable && <>
              <button type="button" className="icon-btn" title={t('common.moveUp')} aria-label={`${t('common.moveUp')} ${f.name}`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={15} /></button>
              <button type="button" className="icon-btn" title={t('common.moveDown')} aria-label={`${t('common.moveDown')} ${f.name}`} disabled={i === files.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={15} /></button>
            </>}
            <button type="button" className="icon-btn" title={t('common.remove')} aria-label={`${t('common.remove')} ${f.name}`} onClick={() => onRemove(f.path)}><Icon name="x" size={15} /></button>
          </div>
        </li>
      ))}
    </ul>
  );
}
