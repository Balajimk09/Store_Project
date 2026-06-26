import { OperationsPage } from '@/app/(admin)/admin/_components/operations-page';

export default function ProductsPage() {
  return (
    <OperationsPage
      title="Products"
      description="View and manage store products, vendors, and promotions."
      endpoint="/api/admin/products"
      rowsKey="products"
      requiredPermissions={['products.view']}
      emptyText="No products found."
      columns={[
        { key: 'item_name', label: 'Product Name' },
        { key: 'upc', label: 'UPC' },
        { key: 'category', label: 'Category' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'store_name', label: 'Store' },
        { key: 'cost_price', label: 'Cost' },
        { key: 'selling_price', label: 'Price' },
        { key: 'stock', label: 'Stock' },
        { key: 'is_active', label: 'Active' },
      ]}
    />
  );
}
