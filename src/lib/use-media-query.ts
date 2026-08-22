'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribes to a CSS media query from JavaScript.
 *
 * Needed where a breakpoint has to change *behaviour*, not just appearance.
 * Tailwind's `lg:hidden` hides an element; it does not stop a modal dialog
 * from trapping focus, marking the page `aria-hidden`, locking body scroll and
 * laying an invisible blocking overlay over everything — all of which a dialog
 * does the moment it is open, whether or not its own markup is visible.
 *
 * `useSyncExternalStore` rather than an effect: the value is read during
 * render, so the correct layout is committed in one pass instead of painting
 * the wrong one and then correcting it. The server has no viewport, so its
 * snapshot answers `false`; anything gated on this must therefore treat
 * "desktop" as the safe assumption, which it is — the desktop arrangement
 * degrades to a long page, while a wrongly-open sheet blocks the whole screen.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * True below Tailwind's `lg` breakpoint — the width at which the project area
 * stops showing two columns and starts showing one thing at a time.
 *
 * `1023.98px` rather than `1023px`: browsers report fractional widths on
 * scaled displays, and a whole-pixel bound leaves a hairline gap where neither
 * this nor `lg:` applies.
 */
export function useIsCompactScreen(): boolean {
  return useMediaQuery('(max-width: 1023.98px)');
}
