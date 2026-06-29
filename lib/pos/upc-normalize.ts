export function normalizeUpc(input: string | null | undefined) {
  const withoutVariant = String(input || '').split('/')[0];
  const digits = withoutVariant.replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(14, '0').slice(-14);
}
