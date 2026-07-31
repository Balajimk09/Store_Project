import { createHash } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import {
  CatalogPilotPreviewInputError,
  buildCatalogPilotPreviewPayload,
} from '@/lib/pos/catalog-pilot-preview-input.mjs';
import {
  CatalogPilotPreviewPersistenceError,
  persistCatalogPilotPreview,
} from '@/lib/pos/catalog-pilot-preview-service.mjs';

export const runtime = 'nodejs';

const COMMANDER_SOURCE_SYSTEM = 'verifone_commander';
const MAX_BODY_BYTES = 64 * 1024;

type ConnectorRow = {
  id: string;
  store_id: string;
  connector_name: string;
  source_system: string;
  source_store_number: string | null;
  status: 'active' | 'disabled';
};

type StoreRow = {
  id: string;
  owner_id: string | null;
};

type ServiceClient = SupabaseClient;

function jsonError(reason: 'unauthorized' | 'invalid_request' | 'idempotency_conflict' | 'server_error', status: number) {
  return NextResponse.json({ ok: false, reason }, { status });
}

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[Catalog Pilot Preview] Missing required Supabase server environment.');
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function hashToken(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function readBoundedJsonBody(request: Request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_BODY_BYTES) {
      throw new CatalogPilotPreviewInputError('invalid_request');
    }
  }

  if (!request.body) throw new CatalogPilotPreviewInputError('invalid_request');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new CatalogPilotPreviewInputError('invalid_request');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CatalogPilotPreviewInputError('invalid_request');
  }

  if (!text || text.length > MAX_BODY_BYTES) throw new CatalogPilotPreviewInputError('invalid_request');

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CatalogPilotPreviewInputError('invalid_request');
  }
}

async function updateConnector(client: ServiceClient, connectorId: string, values: Record<string, string | number | null>) {
  const { error } = await client.from('store_pos_connectors').update(values).eq('id', connectorId);
  if (error) console.error('[Catalog Pilot Preview] Could not update connector status.');
}

export async function POST(request: Request) {
  const contentType = (request.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return jsonError('invalid_request', 415);

  const client = createServiceSupabaseClient();
  if (!client) return jsonError('server_error', 500);

  const rawToken = getBearerToken(request);
  if (!rawToken) return jsonError('unauthorized', 401);

  const { data: connector, error: connectorError } = await client
    .from('store_pos_connectors')
    .select('id, store_id, connector_name, source_system, source_store_number, status')
    .eq('token_hash', hashToken(rawToken))
    .eq('status', 'active')
    .maybeSingle<ConnectorRow>();

  if (connectorError || !connector || connector.source_system !== COMMANDER_SOURCE_SYSTEM) {
    return jsonError('unauthorized', 401);
  }

  const observedAt = new Date().toISOString();
  await updateConnector(client, connector.id, { last_seen_at: observedAt });

  try {
    const { data: store, error: storeError } = await client
      .from('stores')
      .select('id, owner_id')
      .eq('id', connector.store_id)
      .maybeSingle<StoreRow>();

    if (storeError || !store?.owner_id) {
      console.error('[Catalog Pilot Preview] Store ownership lookup failed.');
      return jsonError('server_error', 500);
    }

    const body = await readBoundedJsonBody(request);
    const idempotencyKey = request.headers.get('idempotency-key');
    const payload = buildCatalogPilotPreviewPayload({
      body,
      connector: {
        id: connector.id,
        storeId: connector.store_id,
        sourceSystem: connector.source_system,
        sourceStoreNumber: connector.source_store_number,
      },
      ownerId: store.owner_id,
      idempotencyKey,
    });

    const result = await persistCatalogPilotPreview({ client, payload });
    const completedAt = new Date().toISOString();

    await updateConnector(client, connector.id, {
      last_pull_at: completedAt,
      last_success_at: completedAt,
      last_sync_completed_at: completedAt,
      last_error: null,
      last_error_code: null,
      last_request_id: idempotencyKey,
      consecutive_failure_count: 0,
    });

    return NextResponse.json({
      ok: true,
      syncRunId: result.syncRunId,
      created: result.created,
      connectorName: connector.connector_name,
      storeId: connector.store_id,
      mode: 'selected_products',
      catalogComplete: false,
      previewOnly: true,
      selectionCount: payload.run.selection_count,
      receivedProductCount: payload.run.received_product_count,
    });
  } catch (error) {
    if (error instanceof CatalogPilotPreviewInputError) {
      return jsonError('invalid_request', 400);
    }

    if (error instanceof CatalogPilotPreviewPersistenceError && error.code === 'idempotency_conflict') {
      return jsonError('idempotency_conflict', 409);
    }

    console.error('[Catalog Pilot Preview] Preview ingestion failed.');
    await updateConnector(client, connector.id, {
      last_error: 'Catalog preview ingestion failed.',
      last_error_code: 'catalog_preview_ingestion_failed',
      last_failure_at: new Date().toISOString(),
    });
    return jsonError('server_error', 500);
  }
}
