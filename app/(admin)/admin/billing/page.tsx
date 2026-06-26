import { OperationsPage } from '@/app/(admin)/admin/_components/operations-page';

export default function BillingPage() {
  return (
    <OperationsPage
      title="Billing & Renewals"
      description="Trial reminders, renewals, and billing follow-ups for customer stores."
      endpoint="/api/admin/billing"
      rowsKey="subscriptions"
      requiredPermissions={['renewals.view', 'billing.view']}
      emptyText="No billing or renewal rows found."
      columns={[
        { key: 'store_name', label: 'Store Name' },
        { key: 'plan_name', label: 'Plan' },
        { key: 'status', label: 'Status' },
        { key: 'trial_ends_at', label: 'Trial Ends' },
        { key: 'renewal_due_at', label: 'Renewal Due' },
        { key: 'payment_status', label: 'Payment' },
        { key: 'owner_email', label: 'Owner Email' },
      ]}
    />
  );
}
