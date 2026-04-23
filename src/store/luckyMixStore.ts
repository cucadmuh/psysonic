import { create } from 'zustand';

interface LuckyMixState {
  isRolling: boolean;
  start: () => void;
  stop: () => void;
}

export const useLuckyMixStore = create<LuckyMixState>((set) => ({
  isRolling: false,
  start: () => set({ isRolling: true }),
  stop: () => set({ isRolling: false }),
}));
