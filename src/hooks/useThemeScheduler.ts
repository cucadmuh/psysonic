import { useEffect, useState } from 'react';
import { useThemeStore, getScheduledTheme } from '../store/themeStore';

export function useThemeScheduler(): string {
  const state = useThemeStore();
  const [effectiveTheme, setEffectiveTheme] = useState(() => getScheduledTheme(state));

  useEffect(() => {
    setEffectiveTheme(getScheduledTheme(useThemeStore.getState()));
    if (!state.enableThemeScheduler) return;
    const id = setInterval(() => {
      setEffectiveTheme(getScheduledTheme(useThemeStore.getState()));
    }, 60_000);
    return () => clearInterval(id);
  }, [state.enableThemeScheduler, state.theme, state.themeDay, state.themeNight, state.timeDayStart, state.timeNightStart]);

  return effectiveTheme;
}
