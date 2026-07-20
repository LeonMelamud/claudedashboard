import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Compass size={26} />
      </div>
      <div>
        <div className="hero-gradient text-5xl font-bold">404</div>
        <p className="mt-2 max-w-sm text-sm text-muted">
          This page wandered off — maybe it's exploring a new model. Try the overview, or ⌘K to
          jump anywhere.
        </p>
      </div>
      <Link
        to="/org"
        className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        Back to Overview
      </Link>
    </div>
  );
}
