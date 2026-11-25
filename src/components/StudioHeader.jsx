import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { Icon } from './icons';
import brandMark from '../assets/brush-mark.svg';

const SECTIONS = ['video', 'audio', 'subtitle'];

export default function StudioHeader({ page, onNavigate }) {
  const { t } = useI18n();
  const navButton = (target) => (
    <button
      type="button" className="studio-nav-button" key={target}
      aria-current={page === target ? 'page' : undefined}
      onClick={() => onNavigate(target)}
    >
      <Icon name={target} size={17} /> <span>{t(`nav.${target}`)}</span>
    </button>
  );
  return (
    <header className="studio-header">
      <button type="button" className="brand" title="BrushLLM.com" onClick={() => bridge.openExternal('https://brushllm.com/')}>
        <img src={brandMark} alt="" width="32" height="32" draggable={false} />
        <span>{t('app.name')}</span>
      </button>
      <nav className="studio-nav" aria-label={t('nav.workspace')}>
        {SECTIONS.map(navButton)}
        {navButton('settings')}
      </nav>
    </header>
  );
}
