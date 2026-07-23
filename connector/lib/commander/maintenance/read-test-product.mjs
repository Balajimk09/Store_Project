import { readCommanderProduct } from '../commander-product-integration.mjs';

const safe = (code, fields = []) => ({ read_succeeded: false, authenticated: false, tls_verified: false, product_found: false, identity_matched: false, safe_fields_present: fields, safe_error_code: code });

export async function runReadTestProduct({ input, queue, sessionManager, trust, origin, transport } = {}) {
  if (!input?.approval?.approved) return safe('approval_required');
  if (input.approval.operation !== 'read_test_product') return safe('approval_mismatch');
  if (input.controlled_test_product !== true || typeof input.upc !== 'string' || !/^\d{1,32}$/.test(input.upc) || input.modifier !== undefined && input.modifier !== '000') return safe('invalid_input');
  if (!queue?.enqueue || !sessionManager?.withSession || !trust || typeof origin !== 'string' || typeof transport !== 'function') return safe('internal_failure');
  const queued = await queue.enqueue({ operationType: 'read_test_product' }, async () => sessionManager.withSession(async (cookie) => {
    let read;
    try { read = await readCommanderProduct({ origin, trust, sessionCookie: cookie, upc: input.upc, modifier: '000', transport }); } catch { return safe('vplus_failed'); }
    if (read.status === 'commander_tls_hostname_invalid' || read.status === 'commander_tls_peer_mismatch') return safe(read.status);
    if (read.status === 'session_failed') return safe('authentication_failed');
    if (read.status === 'product_not_found') return safe('product_not_found');
    if (read.status !== 'success') return safe('vplus_failed');
    const product = read.product;
    if (product.upc !== input.upc || product.modifier !== '000' || product.description !== 'STOREPULSE TEST') return safe('product_identity_mismatch');
    return { read_succeeded: true, authenticated: true, tls_verified: true, product_found: true, identity_matched: true, safe_fields_present: ['upc', 'description', 'department', 'price'], safe_error_code: null };
  }));
  if (queued && typeof queued.read_succeeded === 'boolean') return queued;
  if (queued?.error_code === 'commander_connection_failed') return safe('authentication_failed');
  return safe('internal_failure');
}
