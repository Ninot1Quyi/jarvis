import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--color-token-button-background)',
    color: 'var(--color-token-button-foreground)',
  },
  secondary: {
    backgroundColor: 'var(--color-token-bg-fog)',
    color: 'var(--color-token-text-primary)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--color-token-text-secondary)',
  },
  danger: {
    backgroundColor: 'var(--color-token-danger)',
    color: '#ffffff',
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    padding: '4px 10px',
    fontSize: 'var(--text-sm)',
    borderRadius: 'var(--radius-sm)',
  },
  md: {
    padding: '6px 14px',
    fontSize: 'var(--text-base)',
    borderRadius: 'var(--radius-md)',
  },
  lg: {
    padding: '10px 20px',
    fontSize: 'var(--text-lg)',
    borderRadius: 'var(--radius-lg)',
  },
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  className = '',
  onClick,
  ...props
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 transition-opacity font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{ ...variantStyles[variant], ...sizeStyles[size] }}
      onMouseEnter={(e) => {
        if (!disabled && !loading) {
          e.currentTarget.style.opacity = '0.85';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = disabled || loading ? '0.5' : '1';
      }}
      {...props}
    >
      {loading && (
        <span
          className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
        />
      )}
      {children}
    </button>
  );
}
