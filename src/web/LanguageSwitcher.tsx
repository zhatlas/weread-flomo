import { useTranslation } from 'react-i18next';
import { changeLanguage } from './i18n';
import type { Language } from './language';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return <label className="language-switcher"><span>{t('Language')}</span><select aria-label={t('Language')} value={i18n.resolvedLanguage ?? 'en'} onChange={(event) => changeLanguage(event.target.value as Language)}><option value="en" lang="en">English</option><option value="zh-CN" lang="zh-CN">中文</option></select></label>;
}
