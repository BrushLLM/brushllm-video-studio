import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { Icon } from './icons';
import appIcon from '../../build/video-studio.svg';

const SECTIONS = ['video', 'audio', 'subtitle'];

export default function StudioHeader({ page, onNavigate }) {
  const { t, locale } = useI18n();
  const productPage = `https://brushllm.com/${locale === 'en' ? '' : `${locale}/`}video-studio/`;
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
      <button type="button" className="brand" title="BrushLLM.com" onClick={() => bridge.openExternal(productPage)}>
        <img src={appIcon} alt="" width="32" height="32" draggable={false} />
        <span>{t('app.name')}</span>
      </button>
      <nav className="studio-nav" aria-label={t('nav.workspace')}>
        {SECTIONS.map(navButton)}
        {navButton('settings')}
      </nav>
    </header>
  );
}
