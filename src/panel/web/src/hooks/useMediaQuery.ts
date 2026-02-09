import { useState, useEffect, useCallback } from 'react';

/**
 * Hook do nasłuchiwania media queries
 * @param query - Media query string (np. "(max-width: 640px)")
 * @returns boolean - czy media query jest spełnione
 */
export function useMediaQuery(query: string): boolean {
  const getMatches = useCallback((query: string): boolean => {
    // Sprawdź czy jesteśmy w przeglądarce
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  }, []);

  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    // Handler dla zmian media query
    const handleChange = () => {
      setMatches(mediaQuery.matches);
    };

    // Ustaw początkową wartość
    setMatches(mediaQuery.matches);

    // Nasłuchuj zmian
    // Używamy addEventListener dla lepszej kompatybilności
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // Fallback dla starszych przeglądarek
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [query]);

  return matches;
}

/**
 * Hook sprawdzający czy urządzenie jest mobilne (< 640px)
 * Odpowiada breakpointowi 'sm' w Tailwind
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 639px)');
}

/**
 * Hook sprawdzający czy urządzenie jest tabletem (640px - 1023px)
 */
export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 640px) and (max-width: 1023px)');
}

/**
 * Hook sprawdzający czy urządzenie jest desktopem (>= 1024px)
 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/**
 * Hook sprawdzający czy urządzenie ma ekran dotykowy
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}

/**
 * Hook sprawdzający czy użytkownik preferuje reduced motion
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Hook zwracający aktualny breakpoint
 */
export function useBreakpoint(): 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' {
  const isXs = useMediaQuery('(max-width: 374px)');
  const isSm = useMediaQuery('(max-width: 639px)');
  const isMd = useMediaQuery('(max-width: 767px)');
  const isLg = useMediaQuery('(max-width: 1023px)');
  const isXl = useMediaQuery('(max-width: 1279px)');

  if (isXs) return 'xs';
  if (isSm) return 'sm';
  if (isMd) return 'md';
  if (isLg) return 'lg';
  if (isXl) return 'xl';
  return '2xl';
}

export default useMediaQuery;
