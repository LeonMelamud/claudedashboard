import { cn, hashHue, initialsOf } from '@/lib/utils';

export function Avatar({
  name,
  email,
  size = 28,
  className,
}: {
  name: string;
  email?: string | null;
  size?: number;
  className?: string;
}) {
  const hue = hashHue(email ?? name);
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, size * 0.36),
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 32%))`,
        color: 'white',
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
