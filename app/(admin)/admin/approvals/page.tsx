import { OperationsPage } from '@/app/(admin)/admin/_components/operations-page';

export default function ApprovalsPage() {
  return (
    <OperationsPage
      title="Approvals"
      description="Sensitive actions pending review."
      endpoint="/api/admin/approvals"
      rowsKey="approvals"
      requiredPermissions={['approvals.view', 'approval.request_action', 'approval.approve_action', 'approvals.manage']}
      emptyText="No approval requests found."
      columns={[
        { key: 'action_type', label: 'Action Type' },
        { key: 'store_name', label: 'Store' },
        { key: 'requested_by', label: 'Requested By' },
        { key: 'reason', label: 'Reason' },
        { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Requested At' },
      ]}
    />
  );
}
