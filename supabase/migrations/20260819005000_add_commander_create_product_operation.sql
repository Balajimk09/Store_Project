-- Commander create_product operation must be committed in a separate
-- migration before later schema objects may use the new enum value.
alter type public.pos_publish_job_operation
add value if not exists 'create_product';
