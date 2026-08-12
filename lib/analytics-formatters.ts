export function formatAnalyticsMoney(value: number, locale: string) {
  const moneyFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return `${moneyFormatter.format(value)} ₸`;
}
