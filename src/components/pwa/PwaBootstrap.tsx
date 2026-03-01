'use client';

import { useEffect } from 'react';

export default function PwaBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silent fail: PWA push is optional and should never block dashboard UX.
    });
  }, []);

  return null;
}
