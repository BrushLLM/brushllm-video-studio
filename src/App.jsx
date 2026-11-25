import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { I18nProvider } from './i18n';
import { bridge } from './lib/bridge';
import { filterForSection } from '../shared/media.mjs';
import { createHistory, push, back, forward, current } from './lib/navhistory.js';
import ToolPage from './components/ToolPage';
import StudioHeader from './components/StudioHeader';
import SettingsPage from './pages/SettingsPage';
import { JobQueue } from './lib/jobQueue';

const Shell = memo(function Shell({ settings, setSettings, page, setPage, filesBySection, setSectionFiles, transfer, gpuEncoders, platform }) {
  const toolDrafts = useRef({});
  const workspace = useRef(null);
  const moveFocus = useRef(false);

  useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      workspace.current.focus({ preventScroll: true });
    }
  }, [page]);

  const navigateFromWorkspace = useCallback((navigate) => {
    moveFocus.current = true;
    navigate();
  }, []);
  const setFiles = useCallback((updater) => setSectionFiles(page, updater), [page, setSectionFiles]);
  const transferFiles = useCallback((target) => navigateFromWorkspace(() => transfer(target)), [navigateFromWorkspace, transfer]);

  return (
    <div className="app" data-platform={platform}>
      <StudioHeader page={page} onNavigate={setPage} />
      <main className="workspace" ref={workspace} tabIndex={-1} aria-labelledby="workspace-title">
        {['video', 'audio', 'subtitle'].includes(page) ? (
          <ToolPage
            key={page}
            section={page}
            files={filesBySection[page]}
            setFiles={setFiles}
            onTransfer={transferFiles}
            platform={platform}
            gpuEncoders={gpuEncoders}
            defaultOutputDir={settings.outputDir || ''}
            drafts={toolDrafts.current}
          />
        ) : (
          <div className="content">
            <SettingsPage settings={settings} setSettings={setSettings} />
          </div>
        )}
      </main>
    </div>
  );
});

export default function App() {
  const [settings, setSettings] = useState({ language: 'system' });
  const [systemLocale, setSystemLocale] = useState('zh-CN');
  const [jobs, setJobs] = useState([]);
  const [gpuEncoders, setGpuEncoders] = useState([]);
  const [platform, setPlatform] = useState('darwin');
  // Files are kept PER SECTION so switching pages never loses them.
  const [filesBySection, setFilesBySection] = useState({ video: [], audio: [], subtitle: [] });

  // Keep browser-like navigation for the top bar and mouse side buttons.
  const [nav, setNav] = useState(() => createHistory('video'));
  const page = current(nav);
  const setPage = useCallback((next) => setNav((prev) => push(prev, next)), []);
  const goBack = () => setNav((prev) => back(prev));
  const goForward = () => setNav((prev) => forward(prev));

  useEffect(() => {
    bridge.getSettings().then((s) => setSettings(s || { language: 'system' }));
    bridge.appInfo().then((info) => {
      if (info?.locale) setSystemLocale(info.locale);
      if (info?.gpuEncoders) setGpuEncoders(info.gpuEncoders);
      if (info?.platform) setPlatform(info.platform);
    });
    bridge.listJobs().then((snapshot) => setJobs(snapshot.map((job) => ({ ...job }))));
    const off = bridge.onJobsUpdated((job) => {
      const snapshot = { ...job };
      setJobs((prev) => {
        const index = prev.findIndex((item) => item.id === job.id);
        if (index < 0) return [...prev, snapshot];
        const next = [...prev];
        next[index] = snapshot;
        return next;
      });
    });
    const offRemoved = bridge.onJobsRemoved((id) => setJobs((prev) => prev.filter((job) => job.id !== id)));
    const offEngine = bridge.onEngineUpdated(({ gpuEncoders: encoders }) => setGpuEncoders(encoders));
    return () => { off(); offRemoved(); offEngine(); };
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

  const setSectionFiles = useCallback((section, updater) => {
    setFilesBySection((prev) => ({
      ...prev,
      [section]: typeof updater === 'function' ? updater(prev[section]) : updater
    }));
  }, []);

  // "Open in <section> tools": carry the current section's compatible files over.
  // Reset requestToken to trigger fresh probing in the target section.
  const transfer = useCallback((target) => {
    const current = filesBySection[page] || [];
    const { accepted } = filterForSection(current.map((f) => f.path), target);
    if (accepted.length) {
      setSectionFiles(target, (prev) => {
        const requestToken = Date.now() + Math.random();
        const known = new Set(prev.map((f) => f.path));
        const allowed = new Set(accepted);
        const fresh = current
          .filter((file) => allowed.has(file.path) && !known.has(file.path))
          .map((file) => ({ ...file, probing: false, requestToken }));
        return [...prev, ...fresh];
      });
    }
    setPage(target);
  }, [filesBySection, page, setPage, setSectionFiles]);

  return (
    <I18nProvider language={settings.language} systemLocale={systemLocale}>
      <JobQueue.Provider value={jobs}>
        <Shell
          settings={settings} setSettings={setSettings}
          page={page} setPage={setPage}
          filesBySection={filesBySection}
          setSectionFiles={setSectionFiles}
          transfer={transfer}
          gpuEncoders={gpuEncoders}
          platform={platform}
        />
      </JobQueue.Provider>
    </I18nProvider>
  );
}
