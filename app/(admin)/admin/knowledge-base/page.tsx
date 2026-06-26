import { OperationsPage } from '@/app/(admin)/admin/_components/operations-page';

export default function KnowledgeBasePage() {
  return (
    <OperationsPage
      title="Knowledge Base"
      description="Internal and public help articles."
      endpoint="/api/admin/knowledge-base"
      rowsKey="articles"
      requiredPermissions={['knowledge_base.view']}
      emptyText="No knowledge base articles found."
      createLabel="Create Article"
      createEndpoint="/api/admin/knowledge-base"
      createFields={[
        { key: 'title', label: 'Title', required: true },
        { key: 'category', label: 'Category' },
        { key: 'content', label: 'Content', required: true },
      ]}
      columns={[
        { key: 'title', label: 'Title' },
        { key: 'category', label: 'Category' },
        { key: 'visibility', label: 'Visibility' },
        { key: 'status', label: 'Status' },
        { key: 'updated_at', label: 'Updated' },
      ]}
    />
  );
}
