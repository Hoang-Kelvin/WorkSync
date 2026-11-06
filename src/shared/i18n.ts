/**
 * The language of WorkSync's own screens (menus, buttons, messages). It is
 * separate from a project's languages, which decide translations and reports.
 * English text is the key: a text without a translation shows in English.
 */
import { JA } from './i18n-ja';

export type UiLanguage = 'en' | 'ja';
/** System follows the computer's language, or English when WorkSync doesn't have it. */
export type UiLanguageChoice = 'system' | UiLanguage;

export const UI_LANGUAGES: Record<UiLanguage, string> = {
  en: 'English',
  ja: '日本語',
};

export function resolveUiLanguage(
  choice: UiLanguageChoice,
  locale: string,
): UiLanguage {
  if (choice !== 'system') return choice;
  return locale.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** The text in this language, with {name} parts filled in. */
export function translate(
  lang: UiLanguage,
  text: string,
  vars?: Record<string, string | number>,
): string {
  const s = lang === 'ja' ? (JA[text] ?? text) : text;
  return vars
    ? s.replace(/\{(\w+)\}/g, (m, k: string) =>
        k in vars ? String(vars[k]) : m,
      )
    : s;
}
