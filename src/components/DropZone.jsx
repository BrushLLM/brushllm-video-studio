import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { bridge } from '../lib/bridge';
import { acceptsFor, VIDEO_EXTS, AUDIO_EXTS, SUBTITLE_EXTS } from '../../shared/media.mjs';

const EXT_BY_KIND = { video: VIDEO_EXTS, audio: AUDIO_EXTS, subtitle: SUBTITLE_EXTS };

export default function DropZone({ onFiles, section = 'video', compact = false }) {
  const { t } = useI18n();
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef(null);

  const accepts = acceptsFor(section);
  const acceptAttr = accepts.flatMap((k) => (EXT_BY_KIND[k] || []).map((e) => `.${e}`)).join(',');
  const addFiles = (files) => {
    const paths = Array.from(files || [], (file) => bridge.pathForFile(file)).filter(Boolean);
    if (paths.length) onFiles(paths);
  };

  return (
    <div
      className={`dropzone${dragover ? ' dragover' : ''}${compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragover(true);
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) setDragover(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragover(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef} type="file" multiple hidden accept={acceptAttr}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <span className="dropzone-instruction">
        <span className="dropzone-icon"><Icon name="import" size={compact ? 17 : 23} /></span>
        {t('common.dragHere')}
      </span>
      <button
        type="button" className={`btn ${compact ? 'btn-secondary' : 'btn-primary'}`}
        onClick={() => inputRef.current?.click()}
      >
        <Icon name="plus" size={16} /> {t('common.addFiles')}
      </button>
    </div>
  );
}
