import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireSupportPermission } from '@/lib/support-auth';
import {
  isAllowedAttachment,
  jsonError,
  safeFileName,
  textOrNull,
} from '@/app/api/support/_lib';
import { loadTicket } from '@/app/api/admin/support/_lib';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const auth = await requireSupportPermission(request, 'tickets.reply');
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const fileValue = formData.get('file');
  const ticketId = textOrNull(formData.get('ticket_id'));
  if (!(fileValue instanceof File)) return jsonError('File is required.');
  if (!ticketId) return jsonError('Ticket ID is required.');
  if (fileValue.size > MAX_FILE_SIZE) return jsonError('File must be 10MB or smaller.');
  if (!isAllowedAttachment(fileValue)) return jsonError('File type is not allowed.');

  const ticket = await loadTicket(ticketId);
  if (!ticket) return jsonError('Ticket not found.', 404);

  const filename = safeFileName(fileValue.name || 'attachment');
  const path = `admin/${ticket.id}/${Date.now()}-${filename}`;
  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage
    .from('support-attachments')
    .upload(path, fileValue, { contentType: fileValue.type, upsert: false });

  if (error) return jsonError(error.message, 500);

  const { data } = await supabaseAdmin.storage
    .from('support-attachments')
    .createSignedUrl(path, 60 * 60);

  return NextResponse.json({
    path,
    signed_url: data?.signedUrl || null,
    filename,
    size: fileValue.size,
    mime_type: fileValue.type,
  });
}
