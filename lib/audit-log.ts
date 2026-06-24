import { getSupabaseAdmin } from '@/lib/supabase-admin';

type AuditLogInput = {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  targetStoreId?: string | null;
  targetTable?: string | null;
  targetRecordId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  reason?: string | null;
};

export async function createAdminAuditLog(input: AuditLogInput) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from('admin_audit_logs')
      .insert({
        actor_user_id: input.actorUserId,
        action: input.action,
        target_user_id: input.targetUserId || null,
        target_store_id: input.targetStoreId || null,
        target_table: input.targetTable || null,
        target_record_id: input.targetRecordId || null,
        old_values: input.oldValues || null,
        new_values: input.newValues || null,
        metadata: input.metadata || {},
        reason: input.reason || null,
      })
      .select('*')
      .single();

    if (error) {
      console.warn('Failed to create admin audit log:', error.message);
      return null;
    }

    return data;
  } catch (error) {
    console.warn(
      'Failed to create admin audit log:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
