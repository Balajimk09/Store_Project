'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StoreSetupRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/setup');
  }, [router]);
  return null;
}
