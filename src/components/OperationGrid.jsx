import { useI18n } from '../i18n';
import { Icon } from './icons';

// Operation cards grouped by category — no wall of a dozen narrow cards.
export default function OperationGrid({ ops, selected, onSelect }) {
  const { t } = useI18n();
  const groups = [];
  for (const op of ops) {
    const g = op.group || 'other';
    if (!groups.length || groups[groups.length - 1].name !== g) {
      groups.push({ name: g, ops: [] });
    }
    groups[groups.length - 1].ops.push(op);
  }

  const section = ops[0]?.section || 'video';

  return (
    <div className="op-groups">
      {groups.map((group) => (
        <section key={group.name} className="op-group">
          <div className="op-group-label">{t(`group.${group.name}`)}</div>
          <div className={`op-grid domain-${section}`}>
            {group.ops.map((op) => (
              <button
                key={op.id}
                type="button"
                className={`op-card${selected === op.id ? ' selected' : ''}`}
                aria-pressed={selected === op.id}
                onClick={() => onSelect(op.id)}
              >
                <div className="op-icon"><Icon name={op.icon} size={17} /></div>
                <div className="op-body">
                  <div className="op-name">{t(op.id)}</div>
                  <div className="op-desc">{t(`${op.id}.desc`)}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
