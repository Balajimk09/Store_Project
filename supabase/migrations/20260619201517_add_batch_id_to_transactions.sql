ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES upload_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_batch ON transactions (batch_id);
