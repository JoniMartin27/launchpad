import type { Toast } from '../store/useProjects';

/**
 * Toast stack (DESIGN §8): bottom-right, newest on top, max 3 visible (older
 * collapse into a "+N more" row). Discovery toasts carry Add / Ignore actions;
 * error toasts get a red left-tick. Spring-in handled in CSS.
 */
export function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  const visible = toasts.slice(0, 3);
  const overflow = toasts.length - visible.length;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {visible.map((t) => (
        <div className="toast" data-kind={t.kind} key={t.id} role="status">
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
            {t.actions && t.actions.length > 0 && (
              <div className="toast-actions">
                {t.actions.map((a, i) => (
                  <button
                    key={i}
                    className={a.primary ? 'toast-act primary' : 'toast-act'}
                    onClick={() => {
                      a.onClick();
                      onDismiss(t.id);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
      {overflow > 0 && <div className="toast-more">+{overflow} more</div>}
    </div>
  );
}
