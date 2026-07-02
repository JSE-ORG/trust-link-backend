/**
 * Barrel export for the keyboard-a11y feature.
 *
 * Re-exports only pure-logic utilities (no JSX / DOM dependencies)
 * so the NestJS backend tsconfig compiles cleanly.
 */

export {
  FOCUSABLE_SELECTOR,
  getFocusableElements,
  createFocusTrap,
} from './focus-trap.util';
export type { FocusTrap } from './focus-trap.util';

export {
  focusRingStyles,
  ANTI_PATTERN_OUTLINE_NONE,
  validateFocusRing,
  remediateFocusRing,
} from './focus-ring.util';
export type { FocusStyles, FocusRingValidation } from './focus-ring.util';

export { getA11yIssues, validateTabOrder } from './tab-order.util';
export type { ElementDescriptor, A11yIssue } from './tab-order.util';
