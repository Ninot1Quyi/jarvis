import React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

interface SliderProps {
  label?: string;
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

export default function Slider({
  label,
  value,
  onValueChange,
  min,
  max,
  step = 1,
  formatValue,
  disabled,
}: SliderProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      {(label || formatValue) && (
        <div className="flex justify-between items-center">
          {label && (
            <span
              style={{
                color: 'var(--color-token-text-secondary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
              }}
            >
              {label}
            </span>
          )}
          {formatValue && (
            <span
              style={{
                color: 'var(--color-token-text-tertiary)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {formatValue(value)}
            </span>
          )}
        </div>
      )}
      <SliderPrimitive.Root
        value={[value]}
        onValueChange={(vals) => onValueChange(vals[0])}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="relative flex items-center select-none touch-none w-full h-5"
      >
        <SliderPrimitive.Track
          className="relative grow rounded-full h-1.5"
          style={{ backgroundColor: 'var(--color-token-bg-fog)' }}
        >
          <SliderPrimitive.Range
            className="absolute rounded-full h-full"
            style={{ backgroundColor: 'var(--color-token-button-background)' }}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className="block w-4 h-4 rounded-full bg-white shadow-md transition-transform outline-none focus-visible:ring-2"
          style={{
            backgroundColor: 'var(--color-token-button-foreground)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        />
      </SliderPrimitive.Root>
    </div>
  );
}
