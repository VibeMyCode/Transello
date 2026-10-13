// Domains where page text is likely personal/financial: cloud page translation always asks (spec §3 UC-04).
// ponytail: keyword heuristic, not a complete registry; the confirmation is the real safeguard.
const RE = /(^|[.-])(mail|webmail|inbox|bank|banking|ebank|ibank|onlinebank|pay|payment|payments|wallet|billing|checkout|account|accounts|login|signin|secure|health|medical|patient|clinic|tax|gosuslugi|nalog)([.-]|$)|bank|paypal|stripe|revolut|wise\.com|monzo|n26|tinkoff|tbank|sber|alfabank|vtb|raiffeisen|chase\.com|wellsfargo|citi\.com|hsbc|barclays|santander|gmail|outlook\.(live|office)|proton\.me|icloud\.com|yandex\.ru\/mail|mail\.ru/i;

export function isSensitiveHost(host: string): boolean {
  return !!host && RE.test(host);
}
