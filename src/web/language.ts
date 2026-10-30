export const languageStorageKey = 'weread-flomo.language';
export type Language = 'en' | 'zh-CN';
export function preferredLanguage(saved: string | null, browserLanguage: string): Language {
  if (saved === 'en' || saved === 'zh-CN') return saved;
  return /^zh(?:[-_]|$)/i.test(browserLanguage) ? 'zh-CN' : 'en';
}
