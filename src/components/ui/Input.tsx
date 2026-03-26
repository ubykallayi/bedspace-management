import React from 'react';
import { cn } from './Button';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="form-group">
        {label && <label className="form-label">{label}</label>}
        <input
          ref={ref}
          className={cn('form-input', error && 'border-danger', className)}
          {...props}
        />
        {error && <span className="text-danger text-sm" style={{color: 'var(--danger)', fontSize: '0.8rem'}}>{error}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';
