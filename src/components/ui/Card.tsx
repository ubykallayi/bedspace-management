import React from 'react';
import { cn } from './Button';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn('card', className)} {...props}>
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
