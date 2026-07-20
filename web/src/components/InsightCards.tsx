import { Link } from 'react-router-dom';
import { PartyPopper, Info, AlertTriangle, Crown } from 'lucide-react';
import type { InsightCard, UserDto } from '@dash/shared';
import { Avatar } from '@/components/Avatar';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

function userLink(u: UserDto): string {
  return `/user/${encodeURIComponent(u.email ?? String(u.id))}`;
}

export function InsightCardView({
  card,
  usersById,
}: {
  card: InsightCard;
  usersById: Map<number, UserDto>;
}) {
  const users = card.userIds.map((id) => usersById.get(id)).filter((u): u is UserDto => !!u);
  const champions = card.championUserIds
    .map((id) => usersById.get(id))
    .filter((u): u is UserDto => !!u);

  return (
    <div
      className={cn(
        'card flex flex-col gap-2 border-l-2 p-4',
        card.severity === 'positive' && 'border-l-good',
        card.severity === 'info' && 'border-l-accent2',
        card.severity === 'warn' && 'border-l-warn',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
            card.severity === 'positive' && 'bg-good/10 text-good',
            card.severity === 'info' && 'bg-accent2/10 text-accent2',
            card.severity === 'warn' && 'bg-warn/10 text-warn',
          )}
        >
          {card.severity === 'positive' ? (
            <PartyPopper size={14} />
          ) : card.severity === 'warn' ? (
            <AlertTriangle size={14} />
          ) : (
            <Info size={14} />
          )}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug">{card.title}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{card.body}</p>
        </div>
      </div>

      {users.length > 0 && (
        <div className="flex items-center gap-1 pl-9">
          <div className="flex -space-x-1.5">
            {users.slice(0, 8).map((u) => (
              <Tip key={u.id} content={u.name}>
                <Link to={userLink(u)} className="rounded-full ring-2 ring-[var(--card)]">
                  <Avatar name={u.name} email={u.email} size={22} />
                </Link>
              </Tip>
            ))}
          </div>
          {users.length > 8 && <span className="text-[11px] text-muted">+{users.length - 8}</span>}
        </div>
      )}

      {champions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-9">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
            <Crown size={10} className="text-tier-champion" /> can help
          </span>
          {champions.map((c) => (
            <Link
              key={c.id}
              to={userLink(c)}
              className="inline-flex items-center gap-1 rounded-full border border-tier-champion/40 bg-tier-champion/10 px-1.5 py-0.5 text-[11px] font-medium text-tier-champion hover:opacity-80"
            >
              🏆 {c.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
