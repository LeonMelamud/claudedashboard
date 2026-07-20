import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore } from '@/state/toast';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="card pointer-events-auto flex items-start gap-2.5 p-3 shadow-2xl"
          >
            {t.kind === 'success' && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" />}
            {t.kind === 'error' && <XCircle size={16} className="mt-0.5 shrink-0 text-risk" />}
            {t.kind === 'info' && <Info size={16} className="mt-0.5 shrink-0 text-accent" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-muted">{t.body}</div>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-muted hover:text-fg"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
