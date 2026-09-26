'use client';

import { useEffect } from 'react';

export default function useUnsavedChanges(dirty) {
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    function beforeNavigate(event) {
      const link = event.target.closest('a[href]');
      if (
        !link ||
        link.target === '_blank' ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname && destination.search === window.location.search)
        return;
      if (!window.confirm('You have unsaved changes. Leave this page and discard them?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeNavigate, true);
    };
  }, [dirty]);
  return () => !dirty || window.confirm('Discard unsaved changes for this day?');
}
