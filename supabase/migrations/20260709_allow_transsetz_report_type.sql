-- Allow transSet XML imports to be tracked in POS report files.

alter table public.pos_report_files
drop constraint if exists pos_report_files_report_type_check;

alter table public.pos_report_files
add constraint pos_report_files_report_type_check
check (
  report_type in (
    'plu_sales',
    'department_sales',
    'category_sales',
    'tax_summary',
    'payment_summary',
    'fuel_dcr_summary',
    'deal_sales',
    'cashier_summary',
    'transsetz',
    'unknown'
  )
);

notify pgrst, 'reload schema';
