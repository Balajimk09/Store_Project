import { redirect } from 'next/navigation';

export default function PricebookRedirectPage() {
  redirect('/app/products');
}
