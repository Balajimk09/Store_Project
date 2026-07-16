export const POS_PUBLISH_OPERATION = 'update_price' as const;
export const POS_PUBLISH_STATUSES = ['pending', 'claimed', 'sending', 'verifying', 'completed', 'failed', 'cancelled'] as const;

export type PosPublishOperation = typeof POS_PUBLISH_OPERATION;
export type PosPublishJobStatus = (typeof POS_PUBLISH_STATUSES)[number];

export type UpdatePricePayload = {
  price: string;
};

export type PosPublishJob = {
  id: string;
  store_id: string;
  product_id: string;
  requested_by: string;
  assigned_connector_id: string;
  claimed_by_connector_id: string | null;
  operation: PosPublishOperation;
  status: PosPublishJobStatus;
  payload: UpdatePricePayload;
  requested_price: string;
  idempotency_key: string;
  attempt_count: number;
  audit_metadata: Record<string, string | number | boolean | null>;
  claimed_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EnqueueUpdatePriceJobInput = {
  actorUserId: string;
  storeId: string;
  productId: string;
  payload: { price: unknown };
  idempotencyKey: string;
};

export type EnqueueUpdatePriceJobResult = {
  job: PosPublishJob;
  created: boolean;
};
