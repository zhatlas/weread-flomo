import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zh from './locales/zh-CN.json';
import { languageStorageKey, preferredLanguage, type Language } from './language';

let saved: string | null = null;
try { saved = window.localStorage.getItem(languageStorageKey); } catch { /* Storage may be disabled. */ }
const browserLanguage = () => navigator.languages?.[0] || navigator.language || 'en';
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, 'zh-CN': { translation: zh } },
  lng: preferredLanguage(saved, browserLanguage()), supportedLngs: ['en', 'zh-CN'],
  fallbackLng: 'en', load: 'currentOnly', initAsync: false,
  keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false },
});
export const t = (key: string, values?: Record<string, unknown>): string => i18n.t(key, values);
function updateDocument() {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
  document.title = t('WeRead → flomo · Reading inbox');
}
i18n.on('languageChanged', updateDocument);
updateDocument();
export function changeLanguage(language: Language) {
  saved = language;
  try { window.localStorage.setItem(languageStorageKey, language); } catch { /* Keep the choice for this tab. */ }
  void i18n.changeLanguage(language);
}
window.addEventListener('languagechange', () => {
  void i18n.changeLanguage(preferredLanguage(saved, browserLanguage()));
});
export { i18n };
