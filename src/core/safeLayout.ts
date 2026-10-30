/** Phase 1 — Safe-area Android / paysage. Pur et testable (aucune dépendance RN). */
export interface Insets { top: number; bottom: number; left: number; right: number }
export interface Viewport { width: number; height: number }
export interface SafeLayout {
  isLandscape: boolean; contentPaddingBottom: number; controlsBottom: number;
  needsScroll: boolean; minTouchTarget: number; maxContentWidth: number;
}
/** Insets par défaut si l'OS ne les fournit pas : barre de navigation Android ≈ 48dp, geste ≈ 24dp. */
export const DEFAULT_ANDROID_INSETS: Insets = { top: 24, bottom: 48, left: 0, right: 0 };
export function computeSafeLayout(vp: Viewport, insets: Insets = DEFAULT_ANDROID_INSETS, contentHeight = 620): SafeLayout {
  const isLandscape = vp.width > vp.height;
  const safeBottom = Math.max(16, insets.bottom);
  return {
    isLandscape,
    contentPaddingBottom: safeBottom + 24, // boutons jamais sous la barre de navigation
    controlsBottom: safeBottom + 12,
    needsScroll: contentHeight > vp.height - insets.top - safeBottom,
    minTouchTarget: 48, // recommandation Material
    maxContentWidth: isLandscape ? Math.min(vp.width * 0.72, 560) : Math.min(vp.width - 32, 460),
  };
}
/** Vrai si un bouton de `h` dp à `bottom` dp est entièrement visible. */
export function isButtonVisible(vp: Viewport, insets: Insets, bottom: number, h: number): boolean {
  return bottom >= insets.bottom && bottom + h <= vp.height - insets.top;
}
export const TEST_VIEWPORTS: Viewport[] = [
  { width: 360, height: 800 }, { width: 393, height: 873 }, { width: 412, height: 915 },
  { width: 800, height: 360 }, { width: 873, height: 393 }, { width: 915, height: 412 },
];
