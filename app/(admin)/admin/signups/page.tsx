import { OperationsPage } from '@/app/(admin)/admin/_components/operations-page';

export default function SignupsPage() {
  return (
    <OperationsPage
      title="New Signups"
      description="Demo requests, new accounts, onboarding, and follow-ups."
      endpoint="/api/admin/demo-requests"
      rowsKey="demoRequests"
      requiredPermissions={['demo_requests.view', 'signups.view']}
      emptyText="No demo requests or signup follow-ups found."
      createLabel="Add Demo Request"
      createEndpoint="/api/admin/demo-requests"
      createFields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', required: true },
        { key: 'phone', label: 'Phone' },
        { key: 'business_name', label: 'Business Name' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'message', label: 'Message' },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'business_name', label: 'Business' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'source', label: 'Source' },
        { key: 'status', label: 'Status' },
        { key: 'next_follow_up_at', label: 'Next Follow-up' },
        { key: 'created_at', label: 'Created' },
      ]}
    />
  );
}
