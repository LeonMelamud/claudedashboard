import { useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarRange } from 'lucide-react';
import { RANGE_PRESETS, useRangeParams } from '@/hooks/useRangeParams';
import { Segmented, Button, inputCls } from '@/components/ui';
import { fmtDateShort } from '@/lib/format';

export function RangePicker() {
  const { preset, from, to, setPreset, setCustom } = useRangeParams();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  return (
    <div className="flex items-center gap-1.5">
      <Segmented
        options={RANGE_PRESETS.filter((p) => p.id !== 'custom').map((p) => ({ id: p.id, label: p.label }))}
        value={preset}
        onChange={(p) => setPreset(p)}
        size="xs"
      />
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) {
            setDraftFrom(from);
            setDraftTo(to);
          }
        }}
      >
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            className={
              'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ' +
              (preset === 'custom'
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-border bg-bg text-muted hover:text-fg')
            }
          >
            <CalendarRange size={12} />
            {preset === 'custom' ? `${fmtDateShort(from)} – ${fmtDateShort(to)}` : 'Custom'}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side="bottom"
            align="end"
            sideOffset={6}
            className="card pop-in z-50 w-64 space-y-2.5 p-3 shadow-xl"
          >
            <div className="text-xs font-semibold">Custom range (Israel-local days)</div>
            <label className="block text-[11px] text-muted">
              From
              <input
                type="date"
                value={draftFrom}
                max={draftTo}
                onChange={(e) => setDraftFrom(e.target.value)}
                className={inputCls + ' mt-0.5'}
              />
            </label>
            <label className="block text-[11px] text-muted">
              To
              <input
                type="date"
                value={draftTo}
                min={draftFrom}
                onChange={(e) => setDraftTo(e.target.value)}
                className={inputCls + ' mt-0.5'}
              />
            </label>
            <div className="flex justify-end">
              <Button
                variant="primary"
                disabled={!draftFrom || !draftTo || draftFrom > draftTo}
                onClick={() => {
                  setCustom(draftFrom, draftTo);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}

export function GranularityControl() {
  const { gran, setGran } = useRangeParams();
  return (
    <Segmented
      options={[
        { id: 'day' as const, label: 'Day' },
        { id: 'week' as const, label: 'Week' },
        { id: 'month' as const, label: 'Month' },
      ]}
      value={gran}
      onChange={setGran}
      size="xs"
    />
  );
}
