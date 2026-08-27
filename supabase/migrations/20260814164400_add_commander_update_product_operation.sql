-- Add the generalized Commander product mutation operation in its own transaction.
-- A later migration uses the enum value after this migration commits.

alter type public.pos_publish_job_operation
  add value if not exists 'update_product';
