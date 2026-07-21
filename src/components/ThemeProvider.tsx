// Applies the saved accent theme and re-renders the tree when it changes.
// Sits inside SQLiteProvider: the theme is stored per account, and an account
// switch remounts this provider so the new account's theme loads with it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { getSetting, setSetting } from '@/db/repo/settings';
import { applyAccent } from '@/ui/theme';
import { DEFAULT_THEME_NAME, findTheme } from '@/ui/palette';

const KEY_THEME = 'ui.theme';

interface ThemeContextValue {
  themeName: string;
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeName: DEFAULT_THEME_NAME,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  // null = not loaded yet. The first load must always set state (null → name)
  // so the tree re-renders after applyAccent, even when the loaded theme is
  // the default — the colors object may still carry a previous account's accent.
  const [themeName, setThemeName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetting(db, KEY_THEME)
      .then((saved) => {
        if (cancelled) return;
        const theme = findTheme(saved);
        applyAccent(theme.hex);
        setThemeName(theme.name);
      })
      .catch(() => setThemeName(DEFAULT_THEME_NAME));
    return () => {
      cancelled = true;
    };
  }, [db]);

  const setTheme = useCallback(
    (name: string) => {
      const theme = findTheme(name);
      applyAccent(theme.hex);
      setThemeName(theme.name);
      setSetting(db, KEY_THEME, theme.name).catch(() => {});
    },
    [db],
  );

  const value = useMemo(
    () => ({ themeName: themeName ?? DEFAULT_THEME_NAME, setTheme }),
    [themeName, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Subscribes the calling component to theme changes. Any component that uses
 * colors.accent* must call this, or it keeps rendering the previous accent.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
