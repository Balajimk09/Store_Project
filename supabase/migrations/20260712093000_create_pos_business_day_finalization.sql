-- Canonical POS business-day finalization and cash-event foundation.
--
-- This migration is additive for existing live/current-shift ingestion:
-- existing canonical rows are backfilled as active provisional rows, and
-- report totals remain unchanged until a closed business day is finalized.

alter table public.pos_transactions
  add column if not exists record_lifecycle text not null default 'provisional',
  add column if not exists is_active boolean not null default true,
  add column if not exists finalization_id uuid,
  add column if not exists final_import_id uuid references public.pos_transaction_imports(id) on delete restrict,
  add column if not exists superseded_by_finalization_id uuid,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

update public.pos_transactions
set record_lifecycle = coalesce(nullif(record_lifecycle, ''), 'provisional'),
    is_active = coalesce(is_active, true)
where record_lifecycle is null
   or nullif(record_lifecycle, '') is null
   or is_active is null;

-- Deterministic backfill: pre-existing canonical rows predate closed-day
-- reconciliation, so they remain active provisional records until a later
-- closed-period finalization explicitly finalizes or supersedes them.

alter table public.pos_transactions
  add constraint pos_transactions_record_lifecycle_check
    check (record_lifecycle = any (array['provisional'::text, 'final'::text, 'superseded'::text])),
  add constraint pos_transactions_lifecycle_active_check
    check (
      (
        record_lifecycle = 'provisional'
        and is_active = true
        and finalization_id is null
        and final_import_id is null
        and superseded_by_finalization_id is null
        and superseded_at is null
        and superseded_reason is null
      )
      or
      (
        record_lifecycle = 'final'
        and is_active = true
        and finalization_id is not null
        and final_import_id is not null
        and superseded_by_finalization_id is null
        and superseded_at is null
        and superseded_reason is null
      )
      or
      (
        record_lifecycle = 'superseded'
        and is_active = false
        and superseded_by_finalization_id is not null
        and superseded_at is not null
        and nullif(btrim(superseded_reason), '') is not null
        and (
          (finalization_id is null and final_import_id is null)
          or
          (finalization_id is not null and final_import_id is not null)
        )
      )
    );

create table public.pos_business_day_finalizations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  connector_id uuid references public.store_pos_connectors(id) on delete set null,
  source_system text not null default 'verifone_commander',
  source_store_number text,
  business_date date not null,
  period_type text,
  period_number text,
  source_period_label text,
  period_open timestamptz,
  period_close timestamptz,
  closed_import_id uuid references public.pos_transaction_imports(id) on delete set null,
  status text not null default 'uploading'
    check (status = any (array[
      'uploading'::text,
      'uploaded'::text,
      'reconciling'::text,
      'finalized'::text,
      'failed'::text
    ])),
  expected_record_count integer not null check (expected_record_count >= 0),
  received_record_count integer not null default 0 check (received_record_count >= 0),
  final_record_count integer not null default 0 check (final_record_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  superseded_record_count integer not null default 0 check (superseded_record_count >= 0),
  source_file_hash text,
  payload_hash text not null,
  final_source_set_hash text,
  reconciliation_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  uploaded_at timestamptz,
  finalized_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_business_day_finalizations_tenant_key
    unique (id, store_id, owner_id),
  constraint pos_business_day_finalizations_uploaded_after_started_check
    check (uploaded_at is null or uploaded_at >= started_at),
  constraint pos_business_day_finalizations_finalized_after_started_check
    check (finalized_at is null or finalized_at >= started_at),
  constraint pos_business_day_finalizations_failed_after_started_check
    check (failed_at is null or failed_at >= started_at),
  constraint pos_business_day_finalizations_period_close_check
    check (period_open is null or period_close is null or period_close >= period_open)
);

create unique index pos_business_day_finalizations_finalized_identity_idx
  on public.pos_business_day_finalizations(
    store_id,
    source_system,
    coalesce(source_store_number, ''),
    business_date,
    coalesce(period_type, ''),
    coalesce(period_number, '')
  )
  where status = 'finalized';

create index pos_business_day_finalizations_store_date_idx
  on public.pos_business_day_finalizations(store_id, business_date desc);
create index pos_business_day_finalizations_status_idx
  on public.pos_business_day_finalizations(status, updated_at desc);
create index pos_business_day_finalizations_closed_import_idx
  on public.pos_business_day_finalizations(closed_import_id);

alter table public.pos_transactions
  add constraint pos_transactions_finalization_fkey
    foreign key (finalization_id, store_id, owner_id)
    references public.pos_business_day_finalizations(id, store_id, owner_id)
    on delete restrict,
  add constraint pos_transactions_superseded_by_finalization_fkey
    foreign key (superseded_by_finalization_id, store_id, owner_id)
    references public.pos_business_day_finalizations(id, store_id, owner_id)
    on delete restrict;

create table public.pos_business_day_finalization_records (
  id uuid primary key default gen_random_uuid(),
  finalization_id uuid not null,
  store_id uuid not null,
  owner_id uuid not null,
  source_unique_id text not null,
  canonical_hash text not null,
  normalized_record jsonb not null,
  staged_at timestamptz not null default now(),
  applied_transaction_id uuid,
  reconciliation_action text
    check (reconciliation_action is null or reconciliation_action = any (array[
      'inserted'::text,
      'updated'::text,
      'unchanged'::text,
      'failed'::text
    ])),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_business_day_finalization_records_finalization_tenant_fkey
    foreign key (finalization_id, store_id, owner_id)
    references public.pos_business_day_finalizations(id, store_id, owner_id)
    on delete cascade,
  constraint pos_business_day_finalization_records_transaction_fkey
    foreign key (applied_transaction_id, store_id, owner_id)
    references public.pos_transactions(id, store_id, owner_id)
    on delete restrict,
  constraint pos_business_day_finalization_records_json_check
    check (jsonb_typeof(normalized_record) = 'object'),
  constraint pos_business_day_finalization_records_source_unique_check
    check (nullif(btrim(source_unique_id), '') is not null),
  constraint pos_business_day_finalization_records_hash_check
    check (nullif(btrim(canonical_hash), '') is not null),
  constraint pos_business_day_finalization_records_identity_key
    unique (finalization_id, source_unique_id)
);

create index pos_business_day_finalization_records_finalization_idx
  on public.pos_business_day_finalization_records(finalization_id);
create index pos_business_day_finalization_records_transaction_idx
  on public.pos_business_day_finalization_records(applied_transaction_id);

create unique index if not exists pos_transaction_payments_id_transaction_tenant_key
  on public.pos_transaction_payments(id, transaction_id, store_id, owner_id);

create table public.pos_transaction_cash_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  owner_id uuid not null,
  transaction_id uuid not null,
  payment_id uuid,
  event_origin text not null default 'generated'
    check (event_origin = any (array['generated'::text, 'manual'::text])),
  event_number integer not null check (event_number > 0),
  source_system text not null default 'verifone_commander',
  source_event_type text,
  cash_event_type text not null
    check (cash_event_type = any (array[
      'cashback'::text,
      'paid_out'::text,
      'safe_drop'::text,
      'lottery_payout'::text,
      'cash_refund'::text,
      'cash_in'::text,
      'drawer_adjustment'::text,
      'other_cash_adjustment'::text,
      'unknown_cash_event'::text
    ])),
  direction text not null check (direction = any (array['in'::text, 'out'::text])),
  amount numeric(14,2) not null check (amount >= 0),
  signed_amount numeric(14,2) not null,
  affects_sales boolean not null default false,
  affects_drawer_cash boolean not null default true,
  affects_tender_mix boolean not null default false,
  requires_review boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_transaction_cash_events_transaction_tenant_fkey
    foreign key (transaction_id, store_id, owner_id)
    references public.pos_transactions(id, store_id, owner_id)
    on delete cascade,
  constraint pos_transaction_cash_events_payment_fkey
    foreign key (payment_id, transaction_id, store_id, owner_id)
    references public.pos_transaction_payments(id, transaction_id, store_id, owner_id)
    on delete restrict,
  constraint pos_transaction_cash_events_transaction_event_key
    unique (transaction_id, event_origin, event_number),
  constraint pos_transaction_cash_events_sales_check
    check (affects_sales = false),
  constraint pos_transaction_cash_events_signed_amount_check
    check (
      (direction = 'in' and signed_amount = amount)
      or
      (direction = 'out' and signed_amount = -amount)
    ),
  constraint pos_transaction_cash_events_unknown_review_check
    check (cash_event_type <> 'unknown_cash_event' or requires_review = true)
);

create index pos_transaction_cash_events_transaction_tenant_idx
  on public.pos_transaction_cash_events(transaction_id, store_id, owner_id);
create index pos_transaction_cash_events_transaction_origin_idx
  on public.pos_transaction_cash_events(transaction_id, event_origin);
create index pos_transaction_cash_events_owner_idx
  on public.pos_transaction_cash_events(owner_id);
create index pos_transaction_cash_events_store_type_idx
  on public.pos_transaction_cash_events(store_id, cash_event_type);
create index pos_transaction_cash_events_store_created_idx
  on public.pos_transaction_cash_events(store_id, created_at desc);

create index pos_transactions_store_business_active_idx
  on public.pos_transactions(store_id, business_date desc, record_lifecycle, is_active)
  where canonical_record = true;
create index pos_transactions_finalization_idx
  on public.pos_transactions(finalization_id)
  where finalization_id is not null;
create index pos_transactions_superseded_by_finalization_idx
  on public.pos_transactions(superseded_by_finalization_id)
  where superseded_by_finalization_id is not null;

create or replace function public.sync_pos_transaction_cash_events(
  p_transaction_id uuid,
  p_store_id uuid,
  p_owner_id uuid,
  p_transaction jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_cash_back_amount numeric(14,2);
begin
  if p_transaction_id is null or p_store_id is null or p_owner_id is null then
    raise exception using errcode = '22023', message = 'transaction, store, and owner are required for cash event sync';
  end if;

  delete from public.pos_transaction_cash_events
  where transaction_id = p_transaction_id
    and event_origin = 'generated';

  v_cash_back_amount := abs(coalesce(nullif(p_transaction ->> 'cash_back_amount', '')::numeric, 0));

  if v_cash_back_amount > 0 then
    insert into public.pos_transaction_cash_events (
      store_id,
      owner_id,
      transaction_id,
      event_origin,
      event_number,
      source_system,
      source_event_type,
      cash_event_type,
      direction,
      amount,
      signed_amount,
      affects_sales,
      affects_drawer_cash,
      affects_tender_mix,
      requires_review,
      metadata
    ) values (
      p_store_id,
      p_owner_id,
      p_transaction_id,
      'generated',
      1,
      coalesce(nullif(btrim(p_transaction ->> 'source_system'), ''), 'verifone_commander'),
      'cashback',
      'cashback',
      'out',
      v_cash_back_amount,
      -v_cash_back_amount,
      false,
      true,
      false,
      false,
      jsonb_build_object(
        'cash_back_fee',
        coalesce(nullif(p_transaction ->> 'cash_back_fee', '')::numeric, 0)
      )
    );
  end if;

  insert into public.pos_transaction_cash_events (
    store_id,
    owner_id,
    transaction_id,
    event_origin,
    event_number,
    source_system,
    source_event_type,
    cash_event_type,
    direction,
    amount,
    signed_amount,
    affects_sales,
    affects_drawer_cash,
    affects_tender_mix,
    requires_review,
    metadata
  )
  select
    p_store_id,
    p_owner_id,
    p_transaction_id,
    'generated',
    (payment.ordinality::integer + 1000),
    coalesce(nullif(btrim(p_transaction ->> 'source_system'), ''), 'verifone_commander'),
    coalesce(
      nullif(btrim(payment.value ->> 'source_event_type'), ''),
      nullif(btrim(payment.value ->> 'direction'), ''),
      nullif(btrim(payment.value ->> 'payment_code'), '')
    ),
    classified.cash_event_type,
    classified.cash_direction,
    abs(coalesce(nullif(payment.value ->> 'amount', '')::numeric, 0)),
    case
      when classified.cash_direction = 'in'
        then abs(coalesce(nullif(payment.value ->> 'amount', '')::numeric, 0))
      else -abs(coalesce(nullif(payment.value ->> 'amount', '')::numeric, 0))
    end,
    false,
    classified.affects_drawer_cash,
    false,
    classified.requires_review,
    payment.value
  from jsonb_array_elements(
    case
      when jsonb_typeof(p_transaction -> 'payments') = 'array' then p_transaction -> 'payments'
      else '[]'::jsonb
    end
  ) with ordinality as payment(value, ordinality)
  cross join lateral (
    select
      lower(nullif(btrim(payment.value ->> 'cash_event_type'), '')) as explicit_cash_event_type,
      lower(nullif(btrim(payment.value ->> 'direction'), '')) as payment_direction,
      lower(nullif(btrim(payment.value ->> 'payment_code'), '')) as payment_code
  ) as source
  cross join lateral (
    select
      case
        when source.explicit_cash_event_type = any (array[
          'cashback',
          'paid_out',
          'safe_drop',
          'lottery_payout',
          'cash_refund',
          'cash_in',
          'drawer_adjustment',
          'other_cash_adjustment'
        ]) then source.explicit_cash_event_type
        when source.explicit_cash_event_type is not null then 'unknown_cash_event'
        when source.payment_direction = 'cash_paid_out' then 'paid_out'
        when source.payment_direction = 'cash_to_safe' then 'safe_drop'
        when source.payment_direction = 'refund_to_customer' and source.payment_code = 'cash' then 'cash_refund'
        else null
      end as cash_event_type
  ) as event_type
  cross join lateral (
    select
      event_type.cash_event_type,
      case
        when event_type.cash_event_type = 'cash_in' then 'in'
        else 'out'
      end as cash_direction,
      case
        when event_type.cash_event_type = 'unknown_cash_event' then false
        else true
      end as affects_drawer_cash,
      event_type.cash_event_type = 'unknown_cash_event' as requires_review
  ) as classified
  where classified.cash_event_type is not null
    and abs(coalesce(nullif(payment.value ->> 'amount', '')::numeric, 0)) > 0;
end;
$$;

create or replace function public.upsert_pos_transaction(
  p_store_id uuid,
  p_owner_id uuid,
  p_connector_id uuid,
  p_import_id uuid,
  p_transaction jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_store_timezone text;
  v_source_system text;
  v_source_unique_id text;
  v_transaction_time timestamptz;
  v_business_date date;
  v_explicit_business_date_text text;
  v_day_lock_key text;
  v_transaction_lock_key text;
  v_existing_transaction_id uuid;
  v_existing_canonical_hash text;
  v_items jsonb;
  v_payments jsonb;
  v_result jsonb;
begin
  if p_store_id is null then
    raise exception using errcode = '22023', message = 'store_id is required';
  end if;

  if p_owner_id is null or p_import_id is null then
    raise exception using errcode = '22023', message = 'owner_id and import_id are required';
  end if;

  if p_transaction is null or jsonb_typeof(p_transaction) <> 'object' then
    raise exception using errcode = '22023', message = 'transaction payload must be a JSON object';
  end if;

  v_source_system := coalesce(nullif(btrim(p_transaction ->> 'source_system'), ''), 'verifone_commander');
  v_source_unique_id := nullif(btrim(p_transaction ->> 'source_unique_id'), '');

  if v_source_unique_id is null then
    raise exception using errcode = '22023', message = 'source_unique_id is required';
  end if;

  if nullif(btrim(p_transaction ->> 'transaction_time'), '') is null then
    raise exception using errcode = '22023', message = 'transaction_time is required';
  end if;

  begin
    v_transaction_time := (p_transaction ->> 'transaction_time')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22007',
        message = format('invalid transaction_time for source_unique_id %s', v_source_unique_id);
  end;

  select coalesce(nullif(timezone, ''), 'America/Chicago')
    into v_store_timezone
  from public.stores
  where id = p_store_id
    and owner_id = p_owner_id;

  if not found then
    raise exception using errcode = '42501', message = 'store and owner do not match';
  end if;

  v_explicit_business_date_text := nullif(btrim(coalesce(p_transaction ->> 'business_date', '')), '');

  if v_explicit_business_date_text is null then
    v_business_date := (v_transaction_time at time zone v_store_timezone)::date;
  else
    begin
      if v_explicit_business_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception using errcode = '22007';
      end if;

      v_business_date := v_explicit_business_date_text::date;

      if to_char(v_business_date, 'YYYY-MM-DD') <> v_explicit_business_date_text then
        raise exception using errcode = '22007';
      end if;
    exception
      when others then
        raise exception using
          errcode = '22007',
          message = format('invalid business_date for source_unique_id %s', v_source_unique_id);
    end;
  end if;

  v_day_lock_key := p_store_id::text || '|' || v_source_system || '|' || v_business_date::text;
  perform pg_advisory_xact_lock(hashtextextended('pos-business-day|' || v_day_lock_key, 0));

  if exists (
    select 1
    from public.pos_business_day_finalizations as f
    where f.store_id = p_store_id
      and f.source_system = v_source_system
      and f.business_date = v_business_date
      and f.status = 'finalized'
  ) then
    select t.id, t.canonical_hash
      into v_existing_transaction_id, v_existing_canonical_hash
    from public.pos_transactions as t
    where t.store_id = p_store_id
      and t.source_system = v_source_system
      and t.source_unique_id = v_source_unique_id
    limit 1;

    v_items := case
      when jsonb_typeof(p_transaction -> 'items') = 'array' then p_transaction -> 'items'
      else '[]'::jsonb
    end;
    v_payments := case
      when jsonb_typeof(p_transaction -> 'payments') = 'array' then p_transaction -> 'payments'
      else '[]'::jsonb
    end;

    return jsonb_build_object(
      'action', 'unchanged',
      'transaction_id', v_existing_transaction_id,
      'source_unique_id', v_source_unique_id,
      'canonical_hash', coalesce(v_existing_canonical_hash, encode(extensions.digest(p_transaction::text, 'sha256'), 'hex')),
      'line_count', jsonb_array_length(v_items),
      'payment_count', jsonb_array_length(v_payments),
      'relationship_count', 0,
      'ignored_reason', 'business_day_finalized'
    );
  end if;

  v_transaction_lock_key := p_store_id::text || '|' || v_source_system || '|' || v_source_unique_id;
  perform pg_advisory_xact_lock(hashtextextended(v_transaction_lock_key, 0));

  v_result := public.upsert_pos_transaction_unlocked(
    p_store_id,
    p_owner_id,
    p_connector_id,
    p_import_id,
    p_transaction
  );

  perform public.sync_pos_transaction_cash_events(
    (v_result ->> 'transaction_id')::uuid,
    p_store_id,
    p_owner_id,
    p_transaction
  );

  return v_result;
end;
$$;

create or replace function public.begin_pos_business_day_finalization(
  p_store_id uuid,
  p_owner_id uuid,
  p_connector_id uuid,
  p_source_system text,
  p_source_store_number text,
  p_business_date date,
  p_period_type text,
  p_period_number text,
  p_source_period_label text,
  p_period_open timestamptz,
  p_period_close timestamptz,
  p_closed_import_id uuid,
  p_expected_record_count integer,
  p_source_file_hash text,
  p_payload_hash text,
  p_final_source_set_hash text,
  p_reconciliation_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_source_system text;
  v_existing public.pos_business_day_finalizations%rowtype;
  v_finalization_id uuid;
begin
  if p_store_id is null or p_owner_id is null or p_business_date is null then
    raise exception using errcode = '22023', message = 'store_id, owner_id, and business_date are required';
  end if;

  if p_expected_record_count is null or p_expected_record_count < 0 then
    raise exception using errcode = '22023', message = 'expected_record_count must be nonnegative';
  end if;

  if nullif(btrim(coalesce(p_payload_hash, '')), '') is null then
    raise exception using errcode = '22023', message = 'payload_hash is required';
  end if;

  v_source_system := coalesce(nullif(btrim(p_source_system), ''), 'verifone_commander');

  perform pg_advisory_xact_lock(
    hashtextextended(
      'pos-business-day|' || p_store_id::text || '|' || v_source_system || '|' || p_business_date::text,
      0
    )
  );

  if not exists (
    select 1
    from public.stores
    where id = p_store_id
      and owner_id = p_owner_id
  ) then
    raise exception using errcode = '42501', message = 'store and owner do not match';
  end if;

  if p_connector_id is not null and not exists (
    select 1
    from public.store_pos_connectors
    where id = p_connector_id
      and store_id = p_store_id
      and source_system = v_source_system
  ) then
    raise exception using errcode = '42501', message = 'connector does not match store and source system';
  end if;

  if p_closed_import_id is not null and not exists (
    select 1
    from public.pos_transaction_imports
    where id = p_closed_import_id
      and store_id = p_store_id
      and owner_id = p_owner_id
      and source_system = v_source_system
  ) then
    raise exception using errcode = '42501', message = 'closed import does not match store, owner, or source system';
  end if;

  select *
    into v_existing
  from public.pos_business_day_finalizations
  where store_id = p_store_id
    and source_system = v_source_system
    and coalesce(source_store_number, '') = coalesce(nullif(btrim(p_source_store_number), ''), '')
    and business_date = p_business_date
    and coalesce(period_type, '') = coalesce(nullif(btrim(p_period_type), ''), '')
    and coalesce(period_number, '') = coalesce(nullif(btrim(p_period_number), ''), '')
    and status = 'finalized'
  limit 1;

  if found then
    if v_existing.payload_hash = p_payload_hash
       and (
         nullif(btrim(coalesce(p_final_source_set_hash, '')), '') is null
         or coalesce(v_existing.final_source_set_hash, '') = nullif(btrim(p_final_source_set_hash), '')
       ) then
      return jsonb_build_object(
        'finalization_id', v_existing.id,
        'status', v_existing.status,
        'idempotent', true,
        'already_finalized', true
      );
    end if;

    raise exception using
      errcode = '23505',
      message = 'a finalized business day already exists for this source period with a different payload';
  end if;

  select *
    into v_existing
  from public.pos_business_day_finalizations
  where store_id = p_store_id
    and source_system = v_source_system
    and coalesce(source_store_number, '') = coalesce(nullif(btrim(p_source_store_number), ''), '')
    and business_date = p_business_date
    and coalesce(period_type, '') = coalesce(nullif(btrim(p_period_type), ''), '')
    and coalesce(period_number, '') = coalesce(nullif(btrim(p_period_number), ''), '')
    and payload_hash = p_payload_hash
    and coalesce(final_source_set_hash, '') = coalesce(nullif(btrim(p_final_source_set_hash), ''), '')
    and status in ('uploading', 'uploaded', 'reconciling')
  order by created_at desc
  limit 1
  for update;

  if found then
    update public.pos_business_day_finalizations
    set connector_id = coalesce(p_connector_id, connector_id),
        closed_import_id = coalesce(p_closed_import_id, closed_import_id),
        expected_record_count = p_expected_record_count,
        source_file_hash = nullif(btrim(p_source_file_hash), ''),
        reconciliation_metadata = coalesce(p_reconciliation_metadata, '{}'::jsonb),
        error_message = null,
        updated_at = now()
    where id = v_existing.id;

    return jsonb_build_object(
      'finalization_id', v_existing.id,
      'status', v_existing.status,
      'idempotent', true,
      'already_finalized', false
    );
  end if;

  insert into public.pos_business_day_finalizations (
    store_id,
    owner_id,
    connector_id,
    source_system,
    source_store_number,
    business_date,
    period_type,
    period_number,
    source_period_label,
    period_open,
    period_close,
    closed_import_id,
    status,
    expected_record_count,
    source_file_hash,
    payload_hash,
    final_source_set_hash,
    reconciliation_metadata
  ) values (
    p_store_id,
    p_owner_id,
    p_connector_id,
    v_source_system,
    nullif(btrim(p_source_store_number), ''),
    p_business_date,
    nullif(btrim(p_period_type), ''),
    nullif(btrim(p_period_number), ''),
    nullif(btrim(p_source_period_label), ''),
    p_period_open,
    p_period_close,
    p_closed_import_id,
    'uploading',
    p_expected_record_count,
    nullif(btrim(p_source_file_hash), ''),
    p_payload_hash,
    nullif(btrim(p_final_source_set_hash), ''),
    coalesce(p_reconciliation_metadata, '{}'::jsonb)
  )
  returning id into v_finalization_id;

  return jsonb_build_object(
    'finalization_id', v_finalization_id,
    'status', 'uploading',
    'idempotent', false,
    'already_finalized', false
  );
end;
$$;

create or replace function public.stage_pos_business_day_finalization_batch(
  p_finalization_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_finalization public.pos_business_day_finalizations%rowtype;
  v_total_count integer;
  v_inserted_count integer;
  v_updated_count integer;
  v_unchanged_count integer;
begin
  if p_finalization_id is null then
    raise exception using errcode = '22023', message = 'finalization_id is required';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception using errcode = '22023', message = 'records payload must be a JSON array';
  end if;

  select *
    into v_finalization
  from public.pos_business_day_finalizations
  where id = p_finalization_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'finalization session not found';
  end if;

  if v_finalization.status = 'finalized' then
    raise exception using errcode = '23514', message = 'finalized sessions cannot be staged';
  end if;

  if v_finalization.status = 'failed' then
    raise exception using errcode = '23514', message = 'failed sessions cannot be staged';
  end if;

  v_total_count := jsonb_array_length(p_records);

  if v_total_count > 10000 then
    raise exception using errcode = '54000', message = 'staging batch exceeds the 10,000-record safety limit';
  end if;

  if exists (
    with incoming as (
      select nullif(btrim(record.value ->> 'source_unique_id'), '') as source_unique_id
      from jsonb_array_elements(p_records) as record(value)
    )
    select 1
    from incoming
    where source_unique_id is null
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'every staged record requires source_unique_id';
  end if;

  if exists (
    with incoming as (
      select nullif(btrim(record.value ->> 'source_unique_id'), '') as source_unique_id
      from jsonb_array_elements(p_records) as record(value)
    )
    select 1
    from incoming
    group by source_unique_id
    having count(*) > 1
    limit 1
  ) then
    raise exception using errcode = '23505', message = 'staging batch contains duplicate source_unique_id values';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as record(value)
    where coalesce(nullif(btrim(record.value ->> 'source_system'), ''), v_finalization.source_system) <> v_finalization.source_system
       or (record.value ->> 'business_date') is distinct from to_char(v_finalization.business_date, 'YYYY-MM-DD')
       or jsonb_typeof(record.value) <> 'object'
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'staged records must match finalization source system and explicit business date';
  end if;

  with incoming as (
    select
      v_finalization.id as finalization_id,
      v_finalization.store_id as store_id,
      v_finalization.owner_id as owner_id,
      nullif(btrim(record.value ->> 'source_unique_id'), '') as source_unique_id,
      encode(extensions.digest(record.value::text, 'sha256'), 'hex') as canonical_hash,
      record.value as normalized_record
    from jsonb_array_elements(p_records) as record(value)
  ),
  classified as (
    select
      incoming.*,
      existing.id as existing_id,
      existing.canonical_hash as existing_hash,
      existing.normalized_record as existing_record
    from incoming
    left join public.pos_business_day_finalization_records as existing
      on existing.finalization_id = incoming.finalization_id
     and existing.source_unique_id = incoming.source_unique_id
  )
  select
    count(*) filter (where existing_id is null)::integer,
    count(*) filter (
      where existing_id is not null
        and (existing_hash is distinct from canonical_hash or existing_record is distinct from normalized_record)
    )::integer,
    count(*) filter (
      where existing_id is not null
        and existing_hash = canonical_hash
        and existing_record = normalized_record
    )::integer
  into v_inserted_count, v_updated_count, v_unchanged_count
  from classified;

  insert into public.pos_business_day_finalization_records (
    finalization_id,
    store_id,
    owner_id,
    source_unique_id,
    canonical_hash,
    normalized_record,
    staged_at,
    applied_transaction_id,
    reconciliation_action,
    error_code,
    error_message
  )
  select
    v_finalization.id,
    v_finalization.store_id,
    v_finalization.owner_id,
    nullif(btrim(record.value ->> 'source_unique_id'), ''),
    encode(extensions.digest(record.value::text, 'sha256'), 'hex'),
    record.value,
    now(),
    null,
    null,
    null,
    null
  from jsonb_array_elements(p_records) as record(value)
  on conflict (finalization_id, source_unique_id) do update
    set canonical_hash = excluded.canonical_hash,
        normalized_record = excluded.normalized_record,
        staged_at = now(),
        applied_transaction_id = null,
        reconciliation_action = null,
        error_code = null,
        error_message = null,
        updated_at = now();

  update public.pos_business_day_finalizations
  set status = 'uploaded',
      received_record_count = (
        select count(*)::integer
        from public.pos_business_day_finalization_records
        where finalization_id = v_finalization.id
      ),
      uploaded_at = now(),
      error_message = null,
      updated_at = now()
  where id = v_finalization.id;

  return jsonb_build_object(
    'finalization_id', v_finalization.id,
    'status', 'uploaded',
    'batch_record_count', v_total_count,
    'stage_inserted_count', v_inserted_count,
    'stage_updated_count', v_updated_count,
    'stage_unchanged_count', v_unchanged_count,
    'received_record_count', (
      select count(*)::integer
      from public.pos_business_day_finalization_records
      where finalization_id = v_finalization.id
    )
  );
end;
$$;

create or replace function public.finalize_pos_business_day(
  p_finalization_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_finalization public.pos_business_day_finalizations%rowtype;
  v_received_count integer;
  v_record public.pos_business_day_finalization_records%rowtype;
  v_result jsonb;
  v_action text;
  v_transaction_id uuid;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_superseded_count integer := 0;
  v_final_active_count integer;
  v_computed_source_set_hash text;
begin
  if p_finalization_id is null then
    raise exception using errcode = '22023', message = 'finalization_id is required';
  end if;

  select *
    into v_finalization
  from public.pos_business_day_finalizations
  where id = p_finalization_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'finalization session not found';
  end if;

  if v_finalization.status = 'finalized' then
    return jsonb_build_object(
      'finalization_id', v_finalization.id,
      'status', v_finalization.status,
      'already_finalized', true,
      'inserted_count', v_finalization.inserted_count,
      'updated_count', v_finalization.updated_count,
      'unchanged_count', v_finalization.unchanged_count,
      'superseded_record_count', v_finalization.superseded_record_count,
      'final_record_count', v_finalization.final_record_count
    );
  end if;

  if v_finalization.status = 'failed' then
    raise exception using errcode = '23514', message = 'failed finalization sessions cannot be finalized';
  end if;

  if v_finalization.closed_import_id is null then
    raise exception using errcode = '22023', message = 'closed_import_id is required before finalization can apply records';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'pos-business-day|' || v_finalization.store_id::text || '|' || v_finalization.source_system || '|' || v_finalization.business_date::text,
      0
    )
  );

  select count(*)::integer
    into v_received_count
  from public.pos_business_day_finalization_records
  where finalization_id = v_finalization.id;

  if v_received_count <> v_finalization.expected_record_count then
    raise exception using
      errcode = '22023',
      message = format('expected %s final records but received %s', v_finalization.expected_record_count, v_received_count);
  end if;

  select encode(
      extensions.digest(
        coalesce(string_agg(r.source_unique_id || ':' || r.canonical_hash, ',' order by r.source_unique_id), ''),
        'sha256'
      ),
      'hex'
    )
    into v_computed_source_set_hash
  from public.pos_business_day_finalization_records as r
  where r.finalization_id = v_finalization.id;

  if nullif(btrim(coalesce(v_finalization.final_source_set_hash, '')), '') is not null
     and v_finalization.final_source_set_hash <> v_computed_source_set_hash then
    raise exception using
      errcode = '22023',
      message = 'staged final source set does not match expected final_source_set_hash';
  end if;

  if exists (
    select 1
    from public.pos_business_day_finalization_records as r
    where r.finalization_id = v_finalization.id
      and (r.normalized_record ->> 'business_date') is distinct from to_char(v_finalization.business_date, 'YYYY-MM-DD')
    limit 1
  ) then
    raise exception using errcode = '22023', message = 'staged records do not all match finalization business_date';
  end if;

  update public.pos_business_day_finalizations
  set status = 'reconciling',
      received_record_count = v_received_count,
      final_source_set_hash = coalesce(nullif(btrim(final_source_set_hash), ''), v_computed_source_set_hash),
      error_message = null,
      updated_at = now()
  where id = v_finalization.id;

  for v_record in
    select *
    from public.pos_business_day_finalization_records
    where finalization_id = v_finalization.id
    order by source_unique_id
  loop
    v_result := public.upsert_pos_transaction_unlocked(
      v_finalization.store_id,
      v_finalization.owner_id,
      v_finalization.connector_id,
      v_finalization.closed_import_id,
      v_record.normalized_record
    );

    v_action := v_result ->> 'action';
    v_transaction_id := (v_result ->> 'transaction_id')::uuid;

    perform public.sync_pos_transaction_cash_events(
      v_transaction_id,
      v_finalization.store_id,
      v_finalization.owner_id,
      v_record.normalized_record
    );

    update public.pos_transactions
    set record_lifecycle = 'final',
        is_active = true,
        finalization_id = v_finalization.id,
        final_import_id = coalesce(v_finalization.closed_import_id, last_import_id),
        superseded_by_finalization_id = null,
        superseded_at = null,
        superseded_reason = null,
        updated_at = now()
    where id = v_transaction_id;

    update public.pos_business_day_finalization_records
    set applied_transaction_id = v_transaction_id,
        reconciliation_action = v_action,
        error_code = null,
        error_message = null,
        updated_at = now()
    where id = v_record.id;

    case v_action
      when 'inserted' then v_inserted_count := v_inserted_count + 1;
      when 'updated' then v_updated_count := v_updated_count + 1;
      when 'unchanged' then v_unchanged_count := v_unchanged_count + 1;
      else
        raise exception using
          errcode = 'P0001',
          message = format('unexpected finalization upsert action: %s', coalesce(v_action, '<null>'));
    end case;
  end loop;

  update public.pos_transactions as t
  set record_lifecycle = 'superseded',
      is_active = false,
      superseded_by_finalization_id = v_finalization.id,
      superseded_at = now(),
      superseded_reason = 'absent_from_closed_period',
      updated_at = now()
  where t.store_id = v_finalization.store_id
    and t.source_system = v_finalization.source_system
    and t.business_date = v_finalization.business_date
    and t.canonical_record = true
    and t.record_lifecycle = 'provisional'
    and t.is_active = true
    and not exists (
      select 1
      from public.pos_business_day_finalization_records as r
      where r.finalization_id = v_finalization.id
        and r.source_unique_id = t.source_unique_id
    );

  get diagnostics v_superseded_count = row_count;

  select count(*)::integer
    into v_final_active_count
  from public.pos_transactions as t
  where t.store_id = v_finalization.store_id
    and t.source_system = v_finalization.source_system
    and t.business_date = v_finalization.business_date
    and t.canonical_record = true
    and t.record_lifecycle = 'final'
    and t.is_active = true
    and t.finalization_id = v_finalization.id;

  if v_final_active_count <> v_received_count then
    raise exception using
      errcode = 'P0001',
      message = format('final active record count %s does not equal staged record count %s', v_final_active_count, v_received_count);
  end if;

  if exists (
    select 1
    from public.pos_business_day_finalization_records as r
    where r.finalization_id = v_finalization.id
      and not exists (
        select 1
        from public.pos_transactions as t
        where t.store_id = v_finalization.store_id
          and t.source_system = v_finalization.source_system
          and t.business_date = v_finalization.business_date
          and t.canonical_record = true
          and t.record_lifecycle = 'final'
          and t.is_active = true
          and t.finalization_id = v_finalization.id
          and t.source_unique_id = r.source_unique_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'staged final source set is missing from active final transactions';
  end if;

  if exists (
    select 1
    from public.pos_transactions as t
    where t.store_id = v_finalization.store_id
      and t.source_system = v_finalization.source_system
      and t.business_date = v_finalization.business_date
      and t.canonical_record = true
      and t.record_lifecycle = 'final'
      and t.is_active = true
      and t.finalization_id = v_finalization.id
      and not exists (
        select 1
        from public.pos_business_day_finalization_records as r
        where r.finalization_id = v_finalization.id
          and r.source_unique_id = t.source_unique_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'active final transactions contain source IDs outside the staged final source set';
  end if;

  update public.pos_business_day_finalizations
  set status = 'finalized',
      received_record_count = v_received_count,
      final_record_count = v_final_active_count,
      inserted_count = v_inserted_count,
      updated_count = v_updated_count,
      unchanged_count = v_unchanged_count,
      superseded_record_count = v_superseded_count,
      finalized_at = now(),
      failed_at = null,
      error_message = null,
      updated_at = now()
  where id = v_finalization.id;

  return jsonb_build_object(
    'finalization_id', v_finalization.id,
    'status', 'finalized',
    'already_finalized', false,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'unchanged_count', v_unchanged_count,
    'superseded_record_count', v_superseded_count,
    'final_record_count', v_final_active_count
  );
end;
$$;

create or replace function public.mark_pos_business_day_finalization_failed(
  p_finalization_id uuid,
  p_error_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_finalization public.pos_business_day_finalizations%rowtype;
begin
  if p_finalization_id is null then
    raise exception using errcode = '22023', message = 'finalization_id is required';
  end if;

  select *
    into v_finalization
  from public.pos_business_day_finalizations
  where id = p_finalization_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'finalization session not found';
  end if;

  if v_finalization.status = 'finalized' then
    raise exception using errcode = '23514', message = 'finalized sessions cannot be marked failed';
  end if;

  update public.pos_business_day_finalizations
  set status = 'failed',
      error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Finalization failed'), 2000),
      failed_at = now(),
      updated_at = now()
  where id = p_finalization_id;

  return jsonb_build_object(
    'finalization_id', p_finalization_id,
    'status', 'failed'
  );
end;
$$;

create or replace function public.get_canonical_report_coverage(
  p_store_id uuid
)
returns table (
  has_data boolean,
  first_business_date date,
  last_business_date date,
  transaction_count bigint
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select
    count(*) > 0 as has_data,
    min(t.business_date) as first_business_date,
    max(t.business_date) as last_business_date,
    count(*)::bigint as transaction_count
  from public.pos_transactions as t
  where t.store_id = p_store_id
    and t.canonical_record = true
    and t.is_active = true;
$$;

create or replace function public.get_canonical_report_summary(
  p_store_id uuid,
  p_start_business_date date,
  p_end_business_date date
)
returns table (
  gross_sales numeric,
  refund_amount numeric,
  net_sales numeric,
  net_tax numeric,
  completed_sale_count bigint,
  refund_count bigint,
  average_ticket numeric,
  paid_out_count bigint,
  paid_out_amount numeric,
  safe_drop_count bigint,
  safe_drop_amount numeric,
  no_sale_count bigint,
  unclassified_event_count bigint,
  total_header_count bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_store_id is null then
    raise exception using errcode = '22023', message = 'store_id is required';
  end if;

  if p_start_business_date is null then
    raise exception using errcode = '22023', message = 'start business date is required';
  end if;

  if p_end_business_date is null then
    raise exception using errcode = '22023', message = 'end business date is required';
  end if;

  if p_end_business_date < p_start_business_date then
    raise exception using errcode = '22023', message = 'end business date must be greater than or equal to start business date';
  end if;

  return query
  with headers as (
    select
      t.id,
      t.store_id,
      t.owner_id,
      t.transaction_type,
      t.total,
      t.tax_total
    from public.pos_transactions as t
    where t.store_id = p_store_id
      and t.business_date between p_start_business_date and p_end_business_date
      and t.canonical_record = true
      and t.is_active = true
  ),
  header_summary as (
    select
      coalesce(sum(h.total) filter (
        where h.transaction_type in (
          'completed_sale',
          'completed_sale_with_item_void',
          'completed_recalled_sale',
          'fuel_pay_at_pump',
          'fuel_prepay_completed'
        )
      ), 0)::numeric as gross_sales,
      coalesce(sum(abs(h.total)) filter (where h.transaction_type = 'refund'), 0)::numeric as refund_amount,
      coalesce(sum(h.tax_total) filter (
        where h.transaction_type in (
          'completed_sale',
          'completed_sale_with_item_void',
          'completed_recalled_sale',
          'fuel_pay_at_pump',
          'fuel_prepay_completed',
          'refund'
        )
      ), 0)::numeric as net_tax,
      count(*) filter (
        where h.transaction_type in (
          'completed_sale',
          'completed_sale_with_item_void',
          'completed_recalled_sale',
          'fuel_pay_at_pump',
          'fuel_prepay_completed'
        )
      )::bigint as completed_sale_count,
      count(*) filter (where h.transaction_type = 'refund')::bigint as refund_count,
      count(*) filter (where h.transaction_type = 'paid_out')::bigint as paid_out_count,
      count(*) filter (where h.transaction_type = 'safe_drop')::bigint as safe_drop_count,
      count(*) filter (where h.transaction_type = 'no_sale')::bigint as no_sale_count,
      count(*) filter (where h.transaction_type = 'zero_value_event')::bigint as unclassified_event_count,
      count(*)::bigint as total_header_count
    from headers as h
  ),
  cash_event_amounts as (
    select
      coalesce(sum(abs(e.amount)) filter (where e.cash_event_type = 'paid_out'), 0)::numeric as paid_out_amount,
      coalesce(sum(abs(e.amount)) filter (where e.cash_event_type = 'safe_drop'), 0)::numeric as safe_drop_amount
    from headers as h
    left join public.pos_transaction_cash_events as e
      on e.transaction_id = h.id
     and e.store_id = h.store_id
     and e.owner_id = h.owner_id
  ),
  payment_fallback_amounts as (
    select
      coalesce(sum(abs(p.amount)) filter (
        where h.transaction_type = 'paid_out'
          and p.direction = 'cash_paid_out'
          and not exists (
            select 1
            from public.pos_transaction_cash_events as e
            where e.transaction_id = h.id
              and e.cash_event_type = 'paid_out'
          )
      ), 0)::numeric as paid_out_amount,
      coalesce(sum(abs(p.amount)) filter (
        where h.transaction_type = 'safe_drop'
          and p.direction = 'cash_to_safe'
          and not exists (
            select 1
            from public.pos_transaction_cash_events as e
            where e.transaction_id = h.id
              and e.cash_event_type = 'safe_drop'
          )
      ), 0)::numeric as safe_drop_amount
    from headers as h
    left join public.pos_transaction_payments as p
      on p.transaction_id = h.id
     and p.store_id = h.store_id
     and p.owner_id = h.owner_id
  )
  select
    round(s.gross_sales, 2) as gross_sales,
    round(s.refund_amount, 2) as refund_amount,
    round(s.gross_sales - s.refund_amount, 2) as net_sales,
    round(s.net_tax, 2) as net_tax,
    s.completed_sale_count,
    s.refund_count,
    -- Gross average ticket: sale header gross sales divided by completed sale header count, excluding refunds.
    case
      when s.completed_sale_count = 0 then 0::numeric
      else round(s.gross_sales / s.completed_sale_count, 2)
    end as average_ticket,
    s.paid_out_count,
    round(c.paid_out_amount + p.paid_out_amount, 2) as paid_out_amount,
    s.safe_drop_count,
    round(c.safe_drop_amount + p.safe_drop_amount, 2) as safe_drop_amount,
    s.no_sale_count,
    s.unclassified_event_count,
    s.total_header_count
  from header_summary as s
  cross join cash_event_amounts as c
  cross join payment_fallback_amounts as p;
end;
$$;

alter table public.pos_business_day_finalizations enable row level security;
alter table public.pos_business_day_finalization_records enable row level security;
alter table public.pos_transaction_cash_events enable row level security;

create policy "Owners can view pos business day finalizations"
  on public.pos_business_day_finalizations
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can view pos transaction cash events"
  on public.pos_transaction_cash_events
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.pos_business_day_finalizations from anon, authenticated;
revoke all on table public.pos_business_day_finalization_records from anon, authenticated;
revoke all on table public.pos_transaction_cash_events from anon, authenticated;

grant select on table public.pos_business_day_finalizations to authenticated;
grant select on table public.pos_transaction_cash_events to authenticated;

grant all on table public.pos_business_day_finalizations to service_role;
grant all on table public.pos_business_day_finalization_records to service_role;
grant all on table public.pos_transaction_cash_events to service_role;

revoke all on function public.sync_pos_transaction_cash_events(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.sync_pos_transaction_cash_events(uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.sync_pos_transaction_cash_events(uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.sync_pos_transaction_cash_events(uuid, uuid, uuid, jsonb) to service_role;

revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.upsert_pos_transaction(uuid, uuid, uuid, uuid, jsonb) to service_role;

revoke all on function public.begin_pos_business_day_finalization(uuid, uuid, uuid, text, text, date, text, text, text, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb) from public;
revoke all on function public.begin_pos_business_day_finalization(uuid, uuid, uuid, text, text, date, text, text, text, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb) from anon;
revoke all on function public.begin_pos_business_day_finalization(uuid, uuid, uuid, text, text, date, text, text, text, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb) from authenticated;
grant execute on function public.begin_pos_business_day_finalization(uuid, uuid, uuid, text, text, date, text, text, text, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb) to service_role;

revoke all on function public.stage_pos_business_day_finalization_batch(uuid, jsonb) from public;
revoke all on function public.stage_pos_business_day_finalization_batch(uuid, jsonb) from anon;
revoke all on function public.stage_pos_business_day_finalization_batch(uuid, jsonb) from authenticated;
grant execute on function public.stage_pos_business_day_finalization_batch(uuid, jsonb) to service_role;

revoke all on function public.finalize_pos_business_day(uuid) from public;
revoke all on function public.finalize_pos_business_day(uuid) from anon;
revoke all on function public.finalize_pos_business_day(uuid) from authenticated;
grant execute on function public.finalize_pos_business_day(uuid) to service_role;

revoke all on function public.mark_pos_business_day_finalization_failed(uuid, text) from public;
revoke all on function public.mark_pos_business_day_finalization_failed(uuid, text) from anon;
revoke all on function public.mark_pos_business_day_finalization_failed(uuid, text) from authenticated;
grant execute on function public.mark_pos_business_day_finalization_failed(uuid, text) to service_role;

comment on column public.pos_transactions.record_lifecycle is
  'Canonical POS lifecycle: provisional for live/current-shift records, final for closed-period authoritative records, superseded for provisional records absent from a finalized closed set.';
comment on column public.pos_transactions.is_active is
  'Active records contribute to canonical reporting. Superseded audit records remain stored but are excluded from active totals.';
comment on table public.pos_business_day_finalizations is
  'Tracks closed-period canonical POS business-day reconciliation sessions and finalized source sets.';
comment on table public.pos_business_day_finalization_records is
  'Backend-only staged authoritative closed-period normalized records used to atomically finalize one POS business date. Contains raw normalized payload JSON and is not exposed to authenticated store users.';
comment on table public.pos_transaction_cash_events is
  'Normalized drawer cash movement separate from sales revenue and tender reporting. Cash events never affect sales directly.';
comment on function public.begin_pos_business_day_finalization(uuid, uuid, uuid, text, text, date, text, text, text, timestamptz, timestamptz, uuid, integer, text, text, text, jsonb) is
  'Backend-only Phase 1 RPC to begin or resume a closed POS business-day finalization session. Same finalized payload is idempotent; conflicting finalized payloads are rejected.';
comment on function public.stage_pos_business_day_finalization_batch(uuid, jsonb) is
  'Backend-only Phase 1 RPC to stage authoritative closed-period normalized records before they affect active reporting.';
comment on function public.finalize_pos_business_day(uuid) is
  'Backend-only Phase 1 RPC that atomically applies staged closed-period records as final and supersedes active provisional records absent from the authoritative source set.';
comment on function public.mark_pos_business_day_finalization_failed(uuid, text) is
  'Backend-only helper to abandon an unfinished finalization session without changing active transaction state.';
comment on function public.get_canonical_report_coverage(uuid) is
  'SECURITY INVOKER canonical POS coverage helper. Returns business-date coverage for active canonical pos_transactions headers for one explicit store_id and relies on existing RLS.';
comment on function public.get_canonical_report_summary(uuid, date, date) is
  'SECURITY INVOKER canonical POS header summary for inclusive store business dates. Uses active authoritative pos_transactions header totals, excludes superseded rows and cash-management events from sales, and reads paid out/safe drop movement amounts from normalized cash events.';

notify pgrst, 'reload schema';
