import { Store360View } from '@/components/admin/store-360';

type Store360PageProps = {
  params: {
    storeId: string;
  };
};

export default function SuperadminStore360Page({ params }: Store360PageProps) {
  return <Store360View storeId={params.storeId} mode="superadmin" />;
}
