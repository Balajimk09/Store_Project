import { redirect } from 'next/navigation';

export default function LegacyProductsRedirectPage() {
  redirect('/app/products');
}
