import { useEffect, useState } from 'react';
import { resolveTheme } from './themes';

const key = 'odm-studio-theme';
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return resolveTheme(localStorage.getItem(key));
    } catch {
      return resolveTheme(null);
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme.name;
    try {
      localStorage.setItem(key, theme.name);
    } catch {
      /* Storage is optional. */
    }
  }, [theme]);
  return {
    theme,
    setTheme: (name: string) => {
      setTheme(resolveTheme(name));
    },
  };
}
