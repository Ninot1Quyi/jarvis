import React from 'react';

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

export default function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div
      className="flex justify-between items-start gap-6 py-4 px-5"
    >
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <span
          style={{
            color: 'var(--color-token-text-primary)',
            fontSize: 'var(--text-base)',
            fontWeight: 500,
          }}
        >
          {label}
        </span>
        {description && (
          <span
            style={{
              color: 'var(--color-token-text-tertiary)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.55,
            }}
          >
            {description}
          </span>
        )}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}
