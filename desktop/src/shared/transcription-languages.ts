export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'en_US'

export type TranscriptionLanguage = {
  code: string
  label: string
  summaryLanguage: string
}

export const TRANSCRIPTION_LANGUAGES: TranscriptionLanguage[] = [
  { code: 'en_US', label: 'English (US)', summaryLanguage: 'English' },
  { code: 'en_GB', label: 'English (UK)', summaryLanguage: 'English' },
  { code: 'es_ES', label: 'Spanish (Spain)', summaryLanguage: 'Spanish' },
  { code: 'es_MX', label: 'Spanish (Mexico)', summaryLanguage: 'Spanish' },
  { code: 'fr_FR', label: 'French (France)', summaryLanguage: 'French' },
  { code: 'de_DE', label: 'German (Germany)', summaryLanguage: 'German' },
  { code: 'it_IT', label: 'Italian (Italy)', summaryLanguage: 'Italian' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)', summaryLanguage: 'Portuguese' },
  { code: 'ja_JP', label: 'Japanese (Japan)', summaryLanguage: 'Japanese' },
  { code: 'ko_KR', label: 'Korean (Korea)', summaryLanguage: 'Korean' },
  { code: 'zh_CN', label: 'Chinese (Simplified)', summaryLanguage: 'Chinese' },
  { code: 'zh_TW', label: 'Chinese (Traditional)', summaryLanguage: 'Chinese' },
]

export function transcriptionLanguageLabel(code: string): string {
  return TRANSCRIPTION_LANGUAGES.find((language) => language.code === code)?.label ?? code
}
