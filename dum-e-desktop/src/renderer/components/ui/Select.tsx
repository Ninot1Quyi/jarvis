import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

export default function Select({
  label,
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
}: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          style={{
            color: 'var(--color-token-text-secondary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
          }}
        >
          {label}
        </label>
      )}
      <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          className="inline-flex items-center justify-between px-3 py-2 rounded-md gap-2 min-w-[160px] transition-all outline-none"
          style={{
            backgroundColor: 'var(--color-token-input-background)',
            border: '1px solid var(--color-token-input-border)',
            color: 'var(--color-token-text-primary)',
            fontSize: 'var(--text-base)',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown size={16} style={{ color: 'var(--color-token-text-tertiary)' }} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="overflow-hidden rounded-lg shadow-lg"
            style={{
              backgroundColor: 'var(--color-token-bg-tertiary)',
              border: '1px solid var(--color-token-border)',
              zIndex: 1000,
            }}
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer outline-none transition-colors relative"
                  style={{
                    color: 'var(--color-token-text-primary)',
                    fontSize: 'var(--text-base)',
                    userSelect: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-token-list-hover-background)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2">
                    <Check size={14} style={{ color: 'var(--color-token-button-background)' }} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}
