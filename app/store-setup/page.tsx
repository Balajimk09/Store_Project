'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StoreSetupRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/app/setup');
  }, [router]);
  return null;
}
