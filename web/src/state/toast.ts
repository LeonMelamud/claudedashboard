import { create } from 'zustand';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  kind: 'info' | 'success' | 'error';
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export function toast(title: string, kind: Toast['kind'] = 'info', body?: string) {
  useToastStore.getState().push(body === undefined ? { title, kind } : { title, kind, body });
}
