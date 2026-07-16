import 'server-only';
import { getEffectiveStaffAccess } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  PosPublishJobError,
  assertStoreJobAuthorization,
  canInspectPosPublishJobs,
  resolveIdempotency,
  validateIdempotencyKey,
  validateUpdatePricePayload,
} from '@/lib/pos-publish-jobs-core.mjs';
import type {
  EnqueueUpdatePriceJobInput,
  EnqueueUpdatePriceJobResult,
  PosPublishJob,
  UpdatePricePayload,
} from '@/lib/pos-publish-jobs.types';

type StoreOwner = { id: string; owner_id: string };
type ProductStoreRow = { id: string; store_id: string };
type ConnectorRow = { id: string };
type NewJob = {
  store_id: string;
  product_id: string;
  requested_by: string;
  assigned_connector_id: string;
  operation: 'update_price';
  status: 'pending';
  payload: UpdatePricePayload;
  requested_price: string;
  idempotency_key: string;
  audit_metadata: Record<string, never>;
};

export interface PosPublishJobsRepository {
  findStoreOwner(storeId: string): Promise<StoreOwner | null>;
  findProductForStore(storeId: string, productId: string): Promise<ProductStoreRow | null>;
  findActiveConnectorIds(storeId: string): Promise<string[]>;
  findByIdempotencyKey(idempotencyKey: string): Promise<PosPublishJob | null>;
  insertJob(job: NewJob): Promise<PosPublishJob>;
}

function databaseError(error: unknown, fallback: string): never {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  const wrapped = new PosPublishJobError(fallback) as PosPublishJobError & { code?: unknown };
  wrapped.code = code;
  throw wrapped;
}

function asJob(value: unknown): PosPublishJob {
  return value as PosPublishJob;
}

export function createSupabasePosPublishJobsRepository(): PosPublishJobsRepository {
  const supabaseAdmin = getSupabaseAdmin();

  return {
    async findStoreOwner(storeId) {
      const { data, error } = await supabaseAdmin.from('stores').select('id, owner_id').eq('id', storeId).maybeSingle();
      if (error) databaseError(error, 'Unable to verify store access.');
      return (data as StoreOwner | null) || null;
    },
    async findProductForStore(storeId, productId) {
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('id, store_id')
        .eq('id', productId)
        .eq('store_id', storeId)
        .maybeSingle();
      if (error) databaseError(error, 'Unable to verify product ownership.');
      return (data as ProductStoreRow | null) || null;
    },
    async findActiveConnectorIds(storeId) {
      const { data, error } = await supabaseAdmin
        .from('store_pos_connectors')
        .select('id')
        .eq('store_id', storeId)
        .eq('status', 'active')
        .limit(2);
      if (error) databaseError(error, 'Unable to verify the assigned connector.');
      return ((data || []) as ConnectorRow[]).map((connector) => connector.id);
    },
    async findByIdempotencyKey(idempotencyKey) {
      const { data, error } = await supabaseAdmin
        .from('pos_publish_jobs')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) databaseError(error, 'Unable to check idempotency.');
      return data ? asJob(data) : null;
    },
    async insertJob(job) {
      const { data, error } = await supabaseAdmin.from('pos_publish_jobs').insert(job).select('*').single();
      if (error) databaseError(error, 'Unable to create publishing job.');
      return asJob(data);
    },
  };
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}

export async function enqueueUpdatePriceJob(
  input: EnqueueUpdatePriceJobInput,
  repository: PosPublishJobsRepository = createSupabasePosPublishJobsRepository()
): Promise<EnqueueUpdatePriceJobResult> {
  const payload = validateUpdatePricePayload(input.payload) as UpdatePricePayload;
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const store = await repository.findStoreOwner(input.storeId);
  assertStoreJobAuthorization(input.actorUserId, store?.owner_id || '');

  const product = await repository.findProductForStore(input.storeId, input.productId);
  if (!product) throw new PosPublishJobError('Product does not belong to the requesting store.');

  const connectorIds = await repository.findActiveConnectorIds(input.storeId);
  if (connectorIds.length !== 1) {
    throw new PosPublishJobError('Store must have exactly one active connector before a publishing job can be created.');
  }

  const existing = resolveIdempotency(await repository.findByIdempotencyKey(idempotencyKey), input);
  if (existing) return { job: existing, created: false };

  const newJob: NewJob = {
    store_id: input.storeId,
    product_id: product.id,
    requested_by: input.actorUserId,
    assigned_connector_id: connectorIds[0],
    operation: 'update_price',
    status: 'pending',
    payload,
    requested_price: payload.price,
    idempotency_key: idempotencyKey,
    audit_metadata: {},
  };

  try {
    return { job: await repository.insertJob(newJob), created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const duplicate = resolveIdempotency(await repository.findByIdempotencyKey(idempotencyKey), input);
    if (!duplicate) throw new PosPublishJobError('Publishing job idempotency conflict could not be resolved.');
    return { job: duplicate, created: false };
  }
}

export async function listPosPublishJobsForAdmin(actorUserId: string, storeId?: string): Promise<PosPublishJob[]> {
  const access = await getEffectiveStaffAccess(actorUserId);
  if (!canInspectPosPublishJobs(access)) throw new PosPublishJobError('You are not authorized to inspect publishing jobs.');

  const supabaseAdmin = getSupabaseAdmin();
  let query = supabaseAdmin.from('pos_publish_jobs').select('*').order('created_at', { ascending: false }).limit(500);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) databaseError(error, 'Unable to load publishing jobs.');
  return ((data || []) as unknown[]).map(asJob);
}
