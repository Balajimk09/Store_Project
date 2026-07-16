import { NextRequest, NextResponse } from 'next/server';
import { requireAnyAdminPermission } from '@/app/api/admin/_lib';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type StoreRow = {
  id: string;
  store_name: string | null;
  store_code: string | null;
  city: string | null;
  state: string | null;
  pos_type: string | null;
};

type ConnectorRow = {
  id: string;
  store_id: string;
  connector_name: string | null;
  source_system: string | null;
  source_store_number: string | null;
  status: string | null;
  service_version: string | null;
  runtime_mode: string | null;
  reported_state: string | null;
  runtime_started_at: string | null;
  last_heartbeat_at: string | null;
  reported_heartbeat_at: string | null;
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  last_error: string | null;
  commander_status: string | null;
  cloud_status: string | null;
  live_poll_interval_seconds: number | null;
  last_canonical_record_count: number | null;
  last_inserted_count: number | null;
  last_updated_count: number | null;
  last_unchanged_count: number | null;
  last_failed_count: number | null;
  heartbeat_payload_version: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const CONNECTOR_COLUMNS = [
  'id', 'store_id', 'connector_name', 'source_system', 'source_store_number', 'status', 'service_version',
  'runtime_mode', 'reported_state', 'runtime_started_at', 'last_heartbeat_at', 'reported_heartbeat_at',
  'last_seen_at', 'last_upload_at', 'last_sync_started_at', 'last_sync_completed_at', 'last_success_at',
  'last_failure_at', 'last_error_code', 'last_error', 'commander_status', 'cloud_status',
  'live_poll_interval_seconds', 'last_canonical_record_count', 'last_inserted_count', 'last_updated_count',
  'last_unchanged_count', 'last_failed_count', 'heartbeat_payload_version', 'created_at', 'updated_at',
].join(', ');

export async function GET(request: NextRequest) {
  const auth = await requireAnyAdminPermission(request, ['connectors.view', 'stores.view']);
  if (!auth.ok) return auth.response;

  const supabaseAdmin = getSupabaseAdmin();
  const { data: connectorRows, error: connectorError } = await supabaseAdmin
    .from('store_pos_connectors')
    .select(CONNECTOR_COLUMNS)
    .order('created_at', { ascending: false });

  if (connectorError) {
    console.error('[Connector monitoring API] connector query failed', connectorError);
    return NextResponse.json({ error: 'Unable to load connector monitoring data.' }, { status: 500 });
  }

  const connectors = (connectorRows || []) as unknown as ConnectorRow[];
  const storeIds = Array.from(new Set(connectors.map((connector) => connector.store_id).filter(Boolean)));
  const storeById = new Map<string, StoreRow>();

  if (storeIds.length > 0) {
    const { data: storeRows, error: storeError } = await supabaseAdmin
      .from('stores')
      .select('id, store_name, store_code, city, state, pos_type')
      .in('id', storeIds);

    if (storeError) {
      console.error('[Connector monitoring API] store query failed', storeError);
      return NextResponse.json({ error: 'Unable to load connector monitoring data.' }, { status: 500 });
    }

    for (const store of (storeRows || []) as unknown as StoreRow[]) {
      storeById.set(store.id, store);
    }
  }

  return NextResponse.json({
    connectors: connectors.map((connector) => ({
      ...connector,
      store: storeById.get(connector.store_id) || null,
    })),
  });
}
