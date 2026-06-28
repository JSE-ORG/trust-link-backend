/**
 * Focus Ring Utility
 *
 * Provides CSS-in-JS focus ring styles and validation functions to ensure
 * visible focus indicators are always present on interactive elements.
 *
 * The key rule: `outline: none` is ONLY acceptable if accompanied by a
 * visible replacement (box-shadow, border change, etc.).
 */

/**
 * Describes a focus ring style declaration as CSS-in-JS properties.
 * This mirrors a subset of CSSStyleDeclaration relevant to focus visibility.
 */
export interface FocusStyles {
  outline?: string;
  outlineOffset?: string;
  boxShadow?: string;
  border?: string;
  borderColor?: string;
  [key: string]: string | undefined;
}

/**
 * Default focus ring styles — a visible, high-contrast ring that works
 * on both light and dark backgrounds.
 *
 * Uses a 2px solid ring with offset, plus a matching box-shadow fallback
 * for browsers that don't support `outline-offset`.
 */
export const focusRingStyles: FocusStyles = {
  outline: '2px solid #3b82f6',
  outlineOffset: '2px',
  boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.3)',
};

/**
 * Anti-pattern: styles that remove focus visibility without replacement.
 *
 * This is what we're checking for and fixing.
 */
export const ANTI_PATTERN_OUTLINE_NONE: FocusStyles = {
  outline: 'none',
};

/**
 * Result of a focus ring validation check.
 */
export interface FocusRingValidation {
  /** Whether the styles pass the validation check. */
  isValid: boolean;
  /** Array of issues found (empty if valid). */
  issues: string[];
}

/**
 * Checks whether a set of focus styles provides visible focus indication.
 *
 * Rules:
 *  1. If `outline` is NOT `none` / `0` / `0px`, it's valid (browser default is fine).
 *  2. If `outline` IS `none` / `0` / `0px`, there MUST be a visible replacement:
 *     - `boxShadow` (not `none`)
 *     - `border` or `borderColor` change
 *  3. Empty/missing outline is treated as "using browser default" → valid.
 *
 * @param styles — CSS-in-JS styles applied to the element's `:focus` state.
 */
export function validateFocusRing(styles: FocusStyles): FocusRingValidation {
  const issues: string[] = [];

  const outline = styles.outline?.trim().toLowerCase();

  // No outline property or non-suppressive value → browser default is fine
  if (!outline || !isOutlineSuppressed(outline)) {
    return { isValid: true, issues };
  }

  // Outline is suppressed — check for a visible replacement
  const hasBoxShadow =
    !!styles.boxShadow && styles.boxShadow.trim().toLowerCase() !== 'none';

  const hasBorder =
    !!styles.border && styles.border.trim().toLowerCase() !== 'none';

  const hasBorderColor =
    !!styles.borderColor && styles.borderColor.trim() !== '';

  if (!hasBoxShadow && !hasBorder && !hasBorderColor) {
    issues.push(
      `outline is set to "${styles.outline}" without a visible replacement ` +
        `(box-shadow, border, or border-color). This removes the focus indicator ` +
        `for keyboard users.`,
    );
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/**
 * Returns true if the outline value effectively hides the focus indicator.
 */
function isOutlineSuppressed(outline: string): boolean {
  return outline === 'none' || outline === '0' || outline === '0px';
}

/**
 * Given an element's focus styles that fail validation, returns a
 * remediated copy with visible focus ring styles applied.
 *
 * @param styles — The original (failing) styles.
 * @returns A new styles object with `focusRingStyles` merged in.
 */
export function remediateFocusRing(styles: FocusStyles): FocusStyles {
  return {
    ...styles,
    ...focusRingStyles,
  };
}
