import type { ViewTheme } from '../types';

// Preserve Ring's public pure-model seam while sharing it with 3D views.
export * from '../shared/ring-model';

/** Paper themes keep dimmed score ink and resting tracks on the line palette. */
export function ringColours(theme: ViewTheme) {
  const paper = theme.name === 'riso' || theme.name === 'pocket';
  return {
    played: paper ? theme.line : theme.ground,
    resting: paper ? theme.line : theme.muted,
    restingOpacity: paper ? 1 : 0.32,
    paper,
  };
}
