'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { IconButton } from './icon-button';
import { Input, type InputProps } from './input';
import { InputGroup } from './input-group';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'variant' | 'autoComplete'> {
  /** Password managers need to know which one this is (10-forms.md section 21). */
  autoComplete: 'current-password' | 'new-password';
  /** The name of the button while the password is hidden: "Show password". */
  showLabel: string;
  /** The name of the button while the password is shown: "Hide password". */
  hideLabel: string;
}

/**
 * A password of the user's own account, with a button that shows it. Paste and password managers work
 * (WCAG 3.3.8). The button is named by what it will do, so its name changes and it has no pressed state.
 * A provider token is not a password: that is `SecretInput`.
 */
export function PasswordInput({
  autoComplete,
  showLabel,
  hideLabel,
  size = 'md',
  className,
  disabled,
  ...props
}: PasswordInputProps): ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <InputGroup
      data-slot="password-input"
      size={size}
      className={className}
      trailing={
        <IconButton
          icon={shown ? EyeOff : Eye}
          label={shown ? hideLabel : showLabel}
          size="icon-xs"
          disabled={disabled}
          onClick={() => setShown((current) => !current)}
        />
      }
    >
      <Input
        {...props}
        variant="bare"
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        disabled={disabled}
        // A password shown as text must not be corrected or capitalized
        spellCheck={false}
        autoCapitalize="none"
      />
    </InputGroup>
  );
}
