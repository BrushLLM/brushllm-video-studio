import { forwardRef } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './icons';

export default forwardRef(function WindowToolbar({ expanded, onToggle, onBack, onForward, canBack, canForward }, ref) {
  const { t } = useI18n();
  const label = t(expanded ? 'nav.collapse' : 'nav.expand');
  return (
    <header className="window-toolbar">
      <button ref={ref} type="button" className="window-button" title={label} aria-label={label}
        aria-controls="studio-navigation" aria-expanded={expanded} onClick={onToggle}>
        <Icon name={expanded ? 'sidebarClose' : 'sidebarOpen'} size={17} />
      </button>
      <div className="window-history">
        <button type="button" className="window-button" title={t('common.back')} aria-label={t('common.back')}
          disabled={!canBack} onClick={onBack}>
          <Icon name="chevronLeft" size={17} />
        </button>
        <button type="button" className="window-button" title={t('common.forward')} aria-label={t('common.forward')}
          disabled={!canForward} onClick={onForward}>
          <Icon name="chevronRight" size={17} />
        </button>
      </div>
    </header>
  );
});
