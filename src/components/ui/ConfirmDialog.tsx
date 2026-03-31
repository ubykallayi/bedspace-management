import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Card } from './Card';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  if (!open) return null;

  if (typeof document === 'undefined') return null;

  return createPortal((
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div onClick={(event) => event.stopPropagation()} style={{ width: '100%', maxWidth: '460px' }}>
        <Card>
          <h3 style={{ marginBottom: '0.75rem' }}>{title}</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
            <Button variant="primary" onClick={() => void onConfirm()} style={{
              background: tone === 'danger' ? 'var(--danger)' : undefined,
              borderColor: tone === 'danger' ? 'var(--danger)' : undefined,
            }}>
              {confirmLabel}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  ), document.body);
};
