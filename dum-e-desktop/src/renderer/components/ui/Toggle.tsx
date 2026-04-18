import React from 'react';
import * as Switch from '@radix-ui/react-switch';

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export default function Toggle({ checked, onCheckedChange, disabled, label }: ToggleProps) {
  return (
    <div className="flex items-center gap-3">
      {label && (
        <span
          style={{
            color: 'var(--color-token-text-primary)',
            fontSize: 'var(--text-base)',
          }}
        >
          {label}
        </span>
      )}
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="w-10 h-6 rounded-full relative transition-colors cursor-pointer outline-none data-[state=unchecked]:bg-token-bg-fog data-[state=checked]:bg-token-button-background"
        style={{
          backgroundColor: checked ? 'var(--color-token-button-background)' : 'var(--color-token-bg-fog)',
        }}
      >
        <Switch.Thumb
          className="block w-4 h-4 rounded-full bg-white shadow transition-transform will-change-transform translate-x-1 data-[state=checked]:translate-x-5"
        />
      </Switch.Root>
    </div>
  );
}
