import { useEffect } from 'react';

/**
 * Applies an externally-driven emotion preset (happy/angry/sad/relaxed/
 * surprised) to the VRM's expressionManager. A one-time `setValue`, not a
 * per-frame loop: nothing else in this app touches these five names (blink
 * and the lip-sync visemes own their own, disjoint set), so the value holds
 * on the model until the next override arrives.
 *
 * @param {import('@pixiv/three-vrm').VRM | null} vrm
 * @param {{ id: string, weight: number } | null} expressionOverride
 */
export function useExpressionOverride(vrm, expressionOverride) {
  useEffect(() => {
    const manager = vrm?.expressionManager;
    if (!manager || !expressionOverride) return;

    manager.setValue(expressionOverride.id, expressionOverride.weight);
  }, [vrm, expressionOverride]);
}
