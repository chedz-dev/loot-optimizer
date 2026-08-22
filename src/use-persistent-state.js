import { useEffect, useState } from 'react';

export function usePersistentState(storageKey, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored == null ? initialValue : JSON.parse(stored);
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  }, [storageKey, value]);

  return [value, setValue];
}
