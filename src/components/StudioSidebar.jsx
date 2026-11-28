import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { Icon } from './icons';
import appIcon from '../../build/video-studio.svg';

const SECTIONS = ['video', 'audio', 'subtitle'];

export default function StudioSidebar({ page, onNavigate, expanded, toolsRef }) {
  const { t, locale } = useI18n();
  const productPage = `https://brushllm.com/${locale === 'en' ? '' : `${locale}/`}video-studio/`;
  const navButton = (target) => (
    <button
      type="button" className="studio-nav-button" key={target}
      aria-current={page === target ? 'page' : undefined}
      aria-label={t(`nav.${target}`)}
      title={t(`nav.${target}`)}
      onClick={() => onNavigate(target)}
    >
      <Icon name={target} size={17} /> <span className="nav-label">{t(`nav.${target}`)}</span>
    </button>
  );
  return (
    <nav id="studio-navigation" className="studio-sidebar studio-nav" aria-label={t('nav.workspace')}>
      <button type="button" className="brand" aria-label={t('app.name')} title="BrushLLM.com" onClick={() => bridge.openExternal(productPage)}>
        <img src={appIcon} alt="" width="36" height="36" draggable={false} />
        <span className="nav-label"><strong>BrushLLM</strong><span>Video Studio</span></span>
      </button>
      <div className="sidebar-categories">{SECTIONS.map(navButton)}</div>
      {expanded && page !== 'settings' && <div className="sidebar-tools" ref={toolsRef} />}
      <div className="sidebar-footer">{navButton('settings')}</div>
    </nav>
  );
}
