/**
 * An inline yes/no box that replaces `window.confirm`. Native dialogs block
 * the whole tab and cannot be styled, so destructive actions ask here instead,
 * in the same card style as the rest of the dashboard.
 */
export function InlineConfirm({
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="dash-ask" role="group" aria-label="Confirm action">
      <p>{message}</p>
      <div className="dash-ask-actions">
        <button type="button" className="dash-button" disabled={busy} onClick={onConfirm}>
          {busy ? "Working..." : confirmLabel}
        </button>
        <button type="button" className="dash-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
