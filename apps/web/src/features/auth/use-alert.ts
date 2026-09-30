'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * The `FormAlert` of an auth form: the message, a setter, and a ref that moves focus to the alert whenever a
 * new message appears (10-forms.md section 18), so a screen reader reads it and the keyboard starts there.
 */
export function useFormAlert(): {
  alert: string | null;
  setAlert: (message: string | null) => void;
  alertRef: RefObject<HTMLDivElement | null>;
} {
  const [alert, setAlert] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (alert !== null) alertRef.current?.focus();
  }, [alert]);
  return { alert, setAlert, alertRef };
}
