export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'en_US'

type TranscriptionLanguage = {
  code: string
  label: string
  /** Shown in the record bar; the region only where two entries share a language. */
  short: string
  summaryLanguage: string
}

export const TRANSCRIPTION_LANGUAGES: TranscriptionLanguage[] = [
  { code: 'en_US', short: 'EN-US', label: 'English (US)', summaryLanguage: 'English' },
  { code: 'en_GB', short: 'EN-GB', label: 'English (UK)', summaryLanguage: 'English' },
  { code: 'es_ES', short: 'ES-ES', label: 'Spanish (Spain)', summaryLanguage: 'Spanish' },
  { code: 'es_MX', short: 'ES-MX', label: 'Spanish (Mexico)', summaryLanguage: 'Spanish' },
  { code: 'fr_FR', short: 'FR', label: 'French (France)', summaryLanguage: 'French' },
  { code: 'de_DE', short: 'DE', label: 'German (Germany)', summaryLanguage: 'German' },
  { code: 'it_IT', short: 'IT', label: 'Italian (Italy)', summaryLanguage: 'Italian' },
  { code: 'pt_BR', short: 'PT', label: 'Portuguese (Brazil)', summaryLanguage: 'Portuguese' },
  { code: 'ja_JP', short: 'JA', label: 'Japanese (Japan)', summaryLanguage: 'Japanese' },
  { code: 'ko_KR', short: 'KO', label: 'Korean (Korea)', summaryLanguage: 'Korean' },
  { code: 'zh_CN', short: 'ZH-CN', label: 'Chinese (Simplified)', summaryLanguage: 'Chinese' },
  { code: 'zh_TW', short: 'ZH-TW', label: 'Chinese (Traditional)', summaryLanguage: 'Chinese' },
]
