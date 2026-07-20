import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeName = 'dark' | 'light';

interface ThemeState {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}

function applyTheme(t: ThemeName) {
  const el = document.documentElement;
  el.classList.toggle('dark', t === 'dark');
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (t) => {
        applyTheme(t); // apply BEFORE state update so re-renders read fresh CSS vars
        set({ theme: t });
      },
      toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    }),
    { name: 'dash-theme' },
  ),
);

/** Apply persisted theme on boot (index.html ships class="dark" as default). */
export function initTheme() {
  applyTheme(useThemeStore.getState().theme);
}
