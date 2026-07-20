import { useEffect, useRef } from 'react';
import { animate } from 'framer-motion';

export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (v: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(0);
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    const controls = animate(from, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = formatRef.current(v);
      },
    });
    return () => controls.stop();
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
