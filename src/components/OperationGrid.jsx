import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { Icon } from './icons';

export default function OperationGrid({ ops, selected, onSelect, sidebar }) {
  const { t } = useI18n();
  const groups = new Map();
  for (const op of ops) {
    const group = op.group || 'other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(op);
  }
  useLayoutEffect(() => {
    sidebar?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sidebar, selected]);

  if (sidebar) {
    return createPortal([...groups].map(([name, options]) => (
      <div key={name} className="sidebar-tool-group" role="group" aria-label={t(`group.${name}`)}>
        <div className="sidebar-tool-label" aria-hidden="true">{t(`group.${name}`)}</div>
        {options.map((op) => (
          <button key={op.id} type="button" className="studio-nav-button sidebar-operation"
            title={t(op.id)} aria-pressed={op.modal ? undefined : op.id === selected}
            aria-haspopup={op.modal ? 'dialog' : undefined} onClick={() => onSelect(op.id)}>
            <Icon name={op.icon} size={16} /> <span>{t(op.id)}</span>
          </button>
        ))}
      </div>
    )), sidebar);
  }

  const modalTools = ops.filter((op) => op.modal);

  return (
    <section className="tool-picker" aria-labelledby="tool-picker-title">
      <h2 className="section-title" id="tool-picker-title">{t('section.tools')}</h2>
      <div className="tool-picker-controls">
        <select
          className="field tool-select" value={selected} aria-labelledby="tool-picker-title"
          onChange={(e) => onSelect(e.target.value)}
        >
          {[...groups].map(([name, options]) => {
            const tools = options.filter((op) => !op.modal);
            return tools.length > 0 && (
              <optgroup key={name} label={t(`group.${name}`)}>
                {tools.map((op) => <option key={op.id} value={op.id}>{t(op.id)}</option>)}
              </optgroup>
            );
          })}
        </select>
        {modalTools.map((op) => (
          <button key={op.id} type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => onSelect(op.id)}>
            <Icon name={op.icon} size={16} /> {t(op.id)}
          </button>
        ))}
      </div>
    </section>
  );
}
