import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './Button';

type MobileActionItem = {
  label: string;
  onClick: () => void;
};

type MobileActionMenuProps = {
  items: MobileActionItem[];
};

export const MobileActionMenu = ({ items }: MobileActionMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className="mobile-actions-menu mobile-only">
      <Button type="button" variant="secondary" onClick={() => setOpen((current) => !current)}>
        <MoreHorizontal size={16} />
        More
      </Button>
      {open ? (
        <div className="mobile-actions-popover">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="mobile-actions-item"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
