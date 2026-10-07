import { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { bridge } from './lib/bridge';
import { filterForSection } from '../shared/media.mjs';
import { createHistory, push, back, forward, current } from './lib/navhistory.js';
import ToolPage from './components/ToolPage';
import QueuePage from './pages/QueuePage';
import SettingsPage from './pages/SettingsPage';
import { Icon } from './components/icons';
import brandLogo from './assets/brand.png';

const NAV = [
  { id: 'video', icon: 'video' },
  { id: 'audio', icon: 'audio' },
  { id: 'subtitle', icon: 'subtitle' },
  { id: 'queue', icon: 'queue' },
  { id: 'settings', icon: 'settings' }
];

// Shell lives INSIDE the I18nProvider so useI18n works.
function Shell({ settings, setSettings, jobs, setJobs, page, setPage, filesBySection, setSectionFiles, transfer, gpuEncoders, platform }) {
  const { t } = useI18n();
  // Same definition as QueuePage's pending count — paused jobs are still in flight.
  const pending = jobs.filter((j) => ['queued', 'running', 'paused'].includes(j.status)).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={brandLogo} alt="BrushLLM Video Studio" draggable={false} />
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-tag">{t('app.tagline')}</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? ' active' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.icon} size={16} />
              {t(`nav.${item.id}`)}
              {item.id === 'queue' && pending > 0 && <span className="nav-badge">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="footer-link"
            onClick={() => bridge.openExternal('https://brushllm.com')}
            title="brushllm.com"
          >
            Brushllm.com
          </button>
        </div>
      </aside>
      <main className="content">
        {page === 'video' && (
          <ToolPage
            section="video"
            files={filesBySection.video}
            setFiles={(updater) => setSectionFiles('video', updater)}
            onTransfer={transfer}
            gpuEncoders={gpuEncoders}
          />
        )}
        {page === 'audio' && (
          <ToolPage
            section="audio"
            files={filesBySection.audio}
            setFiles={(updater) => setSectionFiles('audio', updater)}
            onTransfer={transfer}
            gpuEncoders={gpuEncoders}
          />
        )}
        {page === 'subtitle' && (
          <ToolPage
            section="subtitle"
            files={filesBySection.subtitle}
            setFiles={(updater) => setSectionFiles('subtitle', updater)}
            onTransfer={transfer}
            gpuEncoders={gpuEncoders}
          />
        )}
        {page === 'queue' && <QueuePage jobs={jobs} setJobs={setJobs} platform={platform} />}
        {page === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} />}
      </main>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState({ language: 'system' });
  const [systemLocale, setSystemLocale] = useState('zh-CN');
  const [jobs, setJobs] = useState([]);
  const [gpuEncoders, setGpuEncoders] = useState([]);
  const [platform, setPlatform] = useState('darwin');
  // Files are kept PER SECTION so switching pages never loses them.
  const [filesBySection, setFilesBySection] = useState({ video: [], audio: [], subtitle: [] });

  // Browser-like navigation history driven by sidebar clicks and the mouse
  // back/forward side buttons.
  const [nav, setNav] = useState(() => createHistory('video'));
  const page = current(nav);
  const setPage = (next) => setNav((prev) => push(prev, next));
  const goBack = () => setNav((prev) => back(prev));
  const goForward = () => setNav((prev) => forward(prev));

  useEffect(() => {
    bridge.getSettings().then((s) => setSettings(s || { language: 'system' }));
    bridge.appInfo().then((info) => {
      if (info?.locale) setSystemLocale(info.locale);
      if (info?.gpuEncoders) setGpuEncoders(info.gpuEncoders);
      if (info?.platform) setPlatform(info.platform);
    });
    bridge.listJobs().then(setJobs);
    const off = bridge.onJobsUpdated((job) => {
      setJobs((prev) => {
        const index = prev.findIndex((item) => item.id === job.id);
        if (index < 0) return [...prev, job];
        const next = [...prev];
        next[index] = job;
        return next;
      });
    });
    return off;
  }, []);

  // Mouse side buttons: XButton1 (button 3) = back, XButton2 (button 4) = forward.
  // Chromium delivers these as mouseup events in the renderer.
  useEffect(() => {
    const onSideButton = (e) => {
      if (e.button === 3) goBack();
      else if (e.button === 4) goForward();
    };
    window.addEventListener('mouseup', onSideButton);
    return () => window.removeEventListener('mouseup', onSideButton);
  }, []);

  const setSectionFiles = (section, updater) => {
    setFilesBySection((prev) => ({
      ...prev,
      [section]: typeof updater === 'function' ? updater(prev[section]) : updater
    }));
  };

  // "Open in <section> tools": carry the current section's compatible files over.
  // Reset requestToken to trigger fresh probing in the target section.
  const transfer = (target) => {
    const current = filesBySection[page] || [];
    const { accepted } = filterForSection(current.map((f) => f.path), target);
    if (accepted.length) {
      setSectionFiles(target, (prev) => {
        const requestToken = Date.now() + Math.random();
        const known = new Set(prev.map((f) => f.path));
        const fresh = accepted
          .filter((p) => !known.has(p))
          .map((p) => {
            const existing = current.find((f) => f.path === p);
            if (existing) {
              return { ...existing, probing: false, requestToken };
            }
            return { path: p, name: p.split(/[/\\]/).pop(), kind: 'video', probing: false, probe: null, raw: null, requestToken };
          });
        return [...prev, ...fresh];
      });
    }
    setPage(target);
  };

  return (
    <I18nProvider language={settings.language} systemLocale={systemLocale}>
      <Shell
        settings={settings} setSettings={setSettings}
        jobs={jobs} setJobs={setJobs}
        page={page} setPage={setPage}
        filesBySection={filesBySection}
        setSectionFiles={setSectionFiles}
        transfer={transfer}
        gpuEncoders={gpuEncoders}
        platform={platform}
      />
    </I18nProvider>
  );
}
