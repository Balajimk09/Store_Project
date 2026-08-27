export function normalizeCanonicalProductBarcode(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isCurrentCanonicalProductBarcodeResolution(resolution, upc) {
  return Boolean(
    resolution
    && resolution.status !== 'idle'
    && resolution.upc === upc,
  );
}

export function doesCanonicalProductBarcodeResolutionBlockCreation(resolution, upc) {
  if (!upc) return false;
  return !isCurrentCanonicalProductBarcodeResolution(resolution, upc) || resolution.status !== 'not_found';
}
