import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { bridge } from '../lib/bridge';
import { acceptsFor, VIDEO_EXTS, AUDIO_EXTS, SUBTITLE_EXTS } from '../../shared/media.mjs';

const EXT_BY_KIND = { video: VIDEO_EXTS, audio: AUDIO_EXTS, subtitle: SUBTITLE_EXTS };

export default function DropZone({ onFiles, section = 'video' }) {
  const { t } = useI18n();
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef(null);

  const accepts = acceptsFor(section);
  const acceptAttr = accepts.flatMap((k) => (EXT_BY_KIND[k] || []).map((e) => `.${e}`)).join(',');

  const filter = (names) => {
    const exts = new Set(accepts.flatMap((k) => EXT_BY_KIND[k] || []));
    return names.filter((n) => {
      const ext = (n.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
      return exts.has(ext);
    });
  };

  // Electron 32+ removed File.path — resolve real paths through the bridge.
  const pathOf = (file) => bridge.pathForFile(file) || file.path || file.name || '';

  const handleDrop = (e) => {
    e.preventDefault();
    setDragover(false);
    const files = [...(e.dataTransfer?.files || [])].map(pathOf).filter(Boolean);
    const ok = filter(files);
    if (ok.length) onFiles(ok);
  };

  return (
    <div
      className={`dropzone${dragover ? ' dragover' : ''}`}
      role="button"
      aria-label={t('common.dragHere')}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef} type="file" multiple hidden accept={acceptAttr}
        onChange={(e) => {
          const files = [...(e.target.files || [])].map(pathOf).filter(Boolean);
          const ok = filter(files);
          if (ok.length) onFiles(ok);
          e.target.value = '';
        }}
      />
      <Icon name="folder" size={26} />
      <div className="dz-main">{t('common.dragHere')}</div>
      <div className="dz-sub">
        {t('common.or')} <button type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>{t('common.browse')}</button>
      </div>
    </div>
  );
}
