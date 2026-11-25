import { useI18n } from '../i18n';
import { Icon } from './icons';

export default function OperationGrid({ ops, selected, onSelect }) {
  const { t } = useI18n();
  const groups = new Map();
  for (const op of ops) {
    if (op.modal) continue;
    const group = op.group || 'other';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(op);
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
          {[...groups].map(([name, options]) => (
            <optgroup key={name} label={t(`group.${name}`)}>
              {options.map((op) => <option key={op.id} value={op.id}>{t(op.id)}</option>)}
            </optgroup>
          ))}
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
