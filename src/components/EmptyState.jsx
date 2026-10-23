import { Icon } from './icons';

// Unified empty state — decorative icon above title/sub copy, with an
// optional children slot for call-to-action buttons.
export default function EmptyState({ icon, title, sub, children }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={40} />
      <div className="es-title">{title}</div>
      {sub && <div className="es-sub">{sub}</div>}
      {children}
    </div>
  );
}
