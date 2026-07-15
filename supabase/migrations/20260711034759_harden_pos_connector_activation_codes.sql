comment on table public.pos_connector_activation_codes is
  'Short-lived, one-time connector activation codes. Only code hashes are stored.';

comment on column public.pos_connector_activation_codes.code_hash is
  'SHA-256 hash of a high-entropy one-time activation code; never store the plaintext code.';

comment on function public.activate_pos_connector(text, text, text) is
  'Backend-only atomic connector activation. Accepts SHA-256 hashes, rotates connector token, and consumes a short-lived code.';
;
