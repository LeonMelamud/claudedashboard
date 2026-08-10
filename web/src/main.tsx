import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { App } from '@/App';
import { initTheme } from '@/state/theme';
import '@/styles/globals.css';

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      // Dashboards live in a background tab for hours. Mount is otherwise the only
      // refetch trigger, so a tab left open serves whatever it loaded that morning.
      refetchOnWindowFocus: true,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider delayDuration={200} skipDelayDuration={200}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TooltipPrimitive.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
