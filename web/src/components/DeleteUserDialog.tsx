import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { UserDto } from '@dash/shared';
import { Button, Field, Modal, inputCls } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useDeleteUser } from '@/lib/queries';
import { toast } from '@/state/toast';

/**
 * Irreversible erase of one user and all their data. Two locks before the
 * button arms: the user's email (or API-key name) typed back exactly, and the
 * server's admin password.
 */
export function DeleteUserDialog({ user }: { user: UserDto }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const del = useDeleteUser();
  const navigate = useNavigate();

  const confirmText = user.email ?? user.apiKeyName ?? user.name;
  const armed = typed.trim() === confirmText && password !== '' && !del.isPending;

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTyped('');
      setPassword('');
      del.reset();
    }
  };

  const errorText = (() => {
    const e = del.error;
    if (!e) return null;
    if (e instanceof ApiError && e.status === 401) return 'Wrong admin password.';
    if (e instanceof ApiError && e.code === 'admin_password_not_configured')
      return 'Deleting users needs ADMIN_PASSWORD set on the server.';
    if (e instanceof ApiError && e.status === 404) return 'This user no longer exists.';
    return e.message;
  })();

  const submit = () => {
    if (!armed) return;
    del.mutate(
      { userId: user.id, adminPassword: password },
      {
        onSuccess: (res) => {
          reset(false);
          toast(`${user.name} was deleted`, 'success', `${res.rowsRemoved.toLocaleString()} rows permanently removed.`);
          navigate('/org', { replace: true });
        },
      },
    );
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} title="Permanently delete this user and all their data">
        <Trash2 size={13} />
        Delete user
      </Button>
      <Modal
        open={open}
        onOpenChange={reset}
        title={
          <span className="inline-flex items-center gap-2 text-risk">
            <AlertTriangle size={16} />
            Permanently delete {user.name}?
          </span>
        }
        className="w-[min(94vw,520px)]"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div role="alert" className="rounded-lg border border-risk/40 bg-risk/10 p-3 text-sm">
            <p className="font-semibold text-risk">This cannot be undone. There is no backup and no recovery.</p>
            <p className="mt-1.5 text-fg/90">
              Every record of this user is erased from the dashboard: usage history, costs, sessions, skills, tools,
              scores, badges, streaks and AI coach feedback. Their team keeps its other members.
            </p>
          </div>
          <p className="text-xs text-muted">
            If this person keeps using Claude Code, the next sync or telemetry event will create them again as a new
            user, starting with no history.
          </p>

          <Field label={`Type ${confirmText} to confirm`}>
            <input
              className={inputCls}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </Field>
          <Field label="Admin password">
            <input
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>

          {errorText && <p className="text-xs font-medium text-risk">{errorText}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => reset(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!armed}
              className="border-transparent bg-risk text-white hover:bg-risk/90"
              variant="danger"
            >
              <Trash2 size={13} />
              {del.isPending ? 'Deleting…' : 'Delete forever'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
