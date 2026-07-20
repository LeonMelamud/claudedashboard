import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  BarChart3,
  HeartPulse,
  Lightbulb,
  Search,
  Settings,
  Sparkles,
  Timer,
  Trophy,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import { useTeams, useUsers } from '@/lib/queries';
import { fuzzyScore, cn } from '@/lib/utils';
import { Avatar } from '@/components/Avatar';

interface PaletteItem {
  id: string;
  group: 'Pages' | 'Teams' | 'People';
  label: string;
  sub?: string;
  to: string;
  icon?: React.ReactNode;
  email?: string | null;
}

const PAGES: PaletteItem[] = [
  { id: 'p-org', group: 'Pages', label: 'Org Overview', to: '/org', icon: <BarChart3 size={14} /> },
  { id: 'p-insights', group: 'Pages', label: 'Insights', to: '/org/insights', icon: <Lightbulb size={14} /> },
  { id: 'p-skills', group: 'Pages', label: 'Skills & Agents', to: '/org/skills', icon: <Sparkles size={14} /> },
  { id: 'p-activity', group: 'Pages', label: 'Activity', to: '/org/activity', icon: <Timer size={14} /> },
  { id: 'p-health', group: 'Pages', label: 'Health', to: '/org/health', icon: <HeartPulse size={14} /> },
  { id: 'p-teams', group: 'Pages', label: 'Teams', to: '/teams', icon: <Users size={14} /> },
  { id: 'p-leaderboard', group: 'Pages', label: 'Leaderboard', to: '/leaderboard', icon: <Trophy size={14} /> },
  { id: 'p-admin-teams', group: 'Pages', label: 'Admin · Teams', to: '/admin/teams', icon: <Wrench size={14} /> },
  { id: 'p-admin-sync', group: 'Pages', label: 'Admin · Sync', to: '/admin/sync', icon: <Wrench size={14} /> },
  { id: 'p-admin-settings', group: 'Pages', label: 'Admin · Settings', to: '/admin/settings', icon: <Settings size={14} /> },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const usersQ = useUsers();
  const teamsQ = useTeams();

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const teams: PaletteItem[] = (teamsQ.data?.teams ?? []).map((t) => ({
      id: `t-${t.id}`,
      group: 'Teams',
      label: t.name,
      sub: `${t.memberCount} members`,
      to: `/team/${t.id}`,
      icon: <Users size={14} />,
    }));
    const users: PaletteItem[] = (usersQ.data?.users ?? [])
      .filter((u) => u.actorType === 'user')
      .map((u) => ({
        id: `u-${u.id}`,
        group: 'People',
        label: u.name,
        sub: u.email ?? undefined,
        to: `/user/${encodeURIComponent(u.email ?? String(u.id))}`,
        icon: <User size={14} />,
        email: u.email,
      }));
    return [...PAGES, ...teams, ...users];
  }, [usersQ.data, teamsQ.data]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 30);
    const scored: Array<{ item: PaletteItem; score: number }> = [];
    for (const item of items) {
      const s = fuzzyScore(query, `${item.label} ${item.sub ?? ''}`);
      if (s !== null) scored.push({ item, score: s });
    }
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((s) => s.item);
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length, query]);

  const select = (item: PaletteItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(filtered[active]);
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastGroup: string | null = null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="card pop-in fixed left-1/2 top-[15%] z-50 w-[min(94vw,560px)] -translate-x-1/2 overflow-hidden p-0 shadow-2xl"
          onKeyDown={onKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
            <Search size={15} className="text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump to a person, team, or page…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60"
            />
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
          </div>
          <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <div className="px-3 py-8 text-center text-xs text-muted">No matches for "{query}"</div>
            )}
            {filtered.map((item, idx) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {header && (
                    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {header}
                    </div>
                  )}
                  <button
                    type="button"
                    data-idx={idx}
                    onClick={() => select(item)}
                    onMouseMove={() => setActive(idx)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
                      idx === active ? 'bg-accent/15 text-fg' : 'text-fg/90',
                    )}
                  >
                    {item.group === 'People' ? (
                      <Avatar name={item.label} email={item.email ?? null} size={20} />
                    ) : (
                      <span className="flex size-5 items-center justify-center text-muted">{item.icon}</span>
                    )}
                    <span className="truncate">{item.label}</span>
                    {item.sub && <span className="ml-auto truncate text-[11px] text-muted">{item.sub}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
