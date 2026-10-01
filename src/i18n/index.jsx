import { createContext, useContext, useEffect, useState } from 'react';
import de from './locales/de';
import en from './locales/en';
import es from './locales/es';
import fr from './locales/fr';
import ptBR from './locales/pt-BR';
import ja from './locales/ja';
import zhCN from './locales/zh-CN';
import zhTW from './locales/zh-TW';
import ko from './locales/ko';

// Language list in the product-standard order (system first).
export const LANGUAGES = [
  { value: 'system', label: '系统语言 / System' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ko', label: '한국어' }
];

const LOCALES = { de, en, es, fr, 'pt-BR': ptBR, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, ko };

export function resolveSystemLocale(raw) {
  const tag = String(raw || '').toLowerCase();
  if (tag.startsWith('zh')) {
    return /tw|hk|hant/.test(tag) ? 'zh-TW' : 'zh-CN';
  }
  if (tag.startsWith('de')) return 'de';
  if (tag.startsWith('es')) return 'es';
  if (tag.startsWith('fr')) return 'fr';
  if (tag.startsWith('pt')) return 'pt-BR';
  if (tag.startsWith('ja')) return 'ja';
  if (tag.startsWith('ko')) return 'ko';
  return 'en';
}

const I18nContext = createContext(null);

export function I18nProvider({ children, language, systemLocale }) {
  const [loc, setLoc] = useState('en');

  useEffect(() => {
    const target = language === 'system' || !language ? resolveSystemLocale(systemLocale || navigator.language) : language;
    setLoc(LOCALES[target] ? target : 'en');
  }, [language, systemLocale]);

  const t = (key, vars) => {
    const table = LOCALES[loc] || en;
    let s = table[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return s;
  };

  return <I18nContext.Provider value={{ t, locale: loc }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
