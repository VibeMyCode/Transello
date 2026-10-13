// Minimal typings for Chrome built-in AI APIs used by Transello (not yet in TypeScript's DOM lib).
type AIAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface CreateMonitor extends EventTarget {}
type CreateMonitorCallback = (monitor: CreateMonitor) => void;

interface Translator {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
  readonly inputQuota?: number;
}
declare var Translator: {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<AIAvailability>;
  create(o: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: CreateMonitorCallback }): Promise<Translator>;
};

interface LanguageDetector {
  detect(input: string, options?: { signal?: AbortSignal }): Promise<{ detectedLanguage: string; confidence: number }[]>;
  destroy(): void;
}
declare var LanguageDetector: {
  availability(o?: { expectedInputLanguages?: string[] }): Promise<AIAvailability>;
  create(o?: { signal?: AbortSignal; monitor?: CreateMonitorCallback }): Promise<LanguageDetector>;
};
