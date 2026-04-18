import React from 'react';

interface InputProps {
  label?: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export default function Input({
  label,
  placeholder,
  type = 'text',
  value,
  onChange,
  error,
  disabled,
  className = '',
}: InputProps) {
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
      <input
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`px-3 py-2 rounded-md transition-all outline-none ${className}`}
        style={{
          backgroundColor: 'var(--color-token-input-background)',
          border: `1px solid ${error ? 'var(--color-token-danger)' : 'var(--color-token-input-border)'}`,
          color: 'var(--color-token-text-primary)',
          fontSize: 'var(--text-base)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'text',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-token-button-background)';
          e.currentTarget.style.boxShadow = '0 0 0 2px color-mix(in oklab, var(--color-token-button-background) 20%, transparent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error
            ? 'var(--color-token-danger)'
            : 'var(--color-token-input-border)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      {error && (
        <span
          style={{
            color: 'var(--color-token-danger)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
