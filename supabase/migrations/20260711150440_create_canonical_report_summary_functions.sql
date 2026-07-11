-- Foundational canonical POS reporting functions for store-owner Reports.
-- These functions aggregate inside PostgreSQL and intentionally do not read
-- legacy public.transactions or line-level report detail tables.

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
    and t.canonical_record = true;
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
    raise exception using
      errcode = '22023',
      message = 'store_id is required';
  end if;

  if p_start_business_date is null then
    raise exception using
      errcode = '22023',
      message = 'start business date is required';
  end if;

  if p_end_business_date is null then
    raise exception using
      errcode = '22023',
      message = 'end business date is required';
  end if;

  if p_end_business_date < p_start_business_date then
    raise exception using
      errcode = '22023',
      message = 'end business date must be greater than or equal to start business date';
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
      coalesce(sum(abs(h.total)) filter (
        where h.transaction_type = 'refund'
      ), 0)::numeric as refund_amount,
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
      coalesce(sum(abs(p.amount)) filter (
        where h.transaction_type = 'paid_out'
          and p.direction = 'cash_paid_out'
      ), 0)::numeric as paid_out_amount,
      coalesce(sum(abs(p.amount)) filter (
        where h.transaction_type = 'safe_drop'
          and p.direction = 'cash_to_safe'
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
    -- Gross average ticket: sale header gross sales divided by sale header count, excluding refunds.
    case
      when s.completed_sale_count = 0 then 0::numeric
      else round(s.gross_sales / s.completed_sale_count, 2)
    end as average_ticket,
    s.paid_out_count,
    round(c.paid_out_amount, 2) as paid_out_amount,
    s.safe_drop_count,
    round(c.safe_drop_amount, 2) as safe_drop_amount,
    s.no_sale_count,
    s.unclassified_event_count,
    s.total_header_count
  from header_summary as s
  cross join cash_event_amounts as c;
end;
$$;

revoke all on function public.get_canonical_report_coverage(uuid) from public;
revoke all on function public.get_canonical_report_coverage(uuid) from anon;
revoke all on function public.get_canonical_report_coverage(uuid) from authenticated;
grant execute on function public.get_canonical_report_coverage(uuid) to authenticated;

revoke all on function public.get_canonical_report_summary(uuid, date, date) from public;
revoke all on function public.get_canonical_report_summary(uuid, date, date) from anon;
revoke all on function public.get_canonical_report_summary(uuid, date, date) from authenticated;
grant execute on function public.get_canonical_report_summary(uuid, date, date) to authenticated;

comment on function public.get_canonical_report_coverage(uuid) is
  'SECURITY INVOKER canonical POS coverage helper. Returns business-date coverage for canonical pos_transactions headers for one explicit store_id and relies on existing RLS.';

comment on function public.get_canonical_report_summary(uuid, date, date) is
  'SECURITY INVOKER canonical POS header summary for inclusive store business dates. Uses authoritative pos_transactions header totals, excludes paid_out, safe_drop, no_sale, and zero_value_event from sales, and reads cash-management movement amounts from pos_transaction_payments.';

notify pgrst, 'reload schema';;
