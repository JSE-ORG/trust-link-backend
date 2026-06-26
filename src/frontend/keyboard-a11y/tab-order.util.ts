/**
 * Tab Order Validation Utility
 *
 * Analyses an array of interactive element descriptors and reports
 * accessibility issues related to keyboard reachability.
 *
 * This is a pure-logic module — no DOM needed. It works with plain
 * objects describing element properties, making it fully testable in Jest.
 */

/**
 * Describes an interactive element's relevant a11y properties.
 * This is a framework-agnostic representation — no DOM dependency.
 */
export interface ElementDescriptor {
  /** HTML tag name (lowercase), e.g. 'button', 'div', 'a'. */
  tagName: string;
  /** The element's tabIndex attribute value, or undefined if not set. */
  tabIndex?: number;
  /** Whether the element has an onClick handler (or equivalent). */
  hasClickHandler: boolean;
  /** Whether the element is disabled. */
  disabled: boolean;
  /** The element's role attribute, if any. */
  role?: string;
  /** Human-readable identifier for error messages (e.g. CSS selector, label). */
  identifier: string;
  /** Whether the element has an aria-label or aria-labelledby. */
  hasAriaLabel: boolean;
  /** focus styles applied to this element, if available */
  focusStyles?: Record<string, string | undefined>;
}

/**
 * A single accessibility issue found during validation.
 */
export interface A11yIssue {
  /** Severity: 'error' = must fix, 'warning' = should fix. */
  severity: 'error' | 'warning';
  /** The element that has the issue. */
  element: string;
  /** Description of the issue. */
  message: string;
  /** Suggested fix. */
  fix: string;
}

/** Tags that are natively focusable without tabIndex. */
const NATIVELY_FOCUSABLE = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
]);

/**
 * Validates an array of interactive element descriptors for keyboard
 * accessibility issues.
 *
 * Checks performed:
 *  1. Non-native elements (div, span) with click handlers MUST have tabIndex=0
 *     and a role, otherwise they're not keyboard-reachable.
 *  2. Interactive elements should NOT have tabIndex > 0 (disrupts natural order).
 *  3. Disabled elements should not be tabbable.
 *  4. Clickable elements without aria-label are flagged as warnings.
 *
 * @param elements — Array of element descriptors to validate.
 * @returns Array of issues found (empty = all good).
 */
export function getA11yIssues(elements: ElementDescriptor[]): A11yIssue[] {
  const issues: A11yIssue[] = [];

  for (const el of elements) {
    const isNativelyFocusable = NATIVELY_FOCUSABLE.has(el.tagName);

    // Check 1: Non-native element with click handler but no tabIndex
    if (
      !isNativelyFocusable &&
      el.hasClickHandler &&
      !el.disabled &&
      (el.tabIndex === undefined || el.tabIndex < 0)
    ) {
      issues.push({
        severity: 'error',
        element: el.identifier,
        message:
          `<${el.tagName}> has a click handler but is not keyboard-reachable ` +
          `(tabIndex is ${el.tabIndex ?? 'not set'}).`,
        fix: `Add tabIndex={0} and role="${el.role || 'button'}" to make it tabbable.`,
      });
    }

    // Check 2: Non-native element with click handler but no role
    if (
      !isNativelyFocusable &&
      el.hasClickHandler &&
      !el.disabled &&
      !el.role
    ) {
      issues.push({
        severity: 'error',
        element: el.identifier,
        message:
          `<${el.tagName}> has a click handler but no ARIA role. ` +
          `Screen readers won't announce it as interactive.`,
        fix: `Add role="button" (or the appropriate widget role).`,
      });
    }

    // Check 3: tabIndex > 0 disrupts natural tab order
    if (el.tabIndex !== undefined && el.tabIndex > 0) {
      issues.push({
        severity: 'warning',
        element: el.identifier,
        message:
          `tabIndex=${el.tabIndex} moves this element out of natural DOM order. ` +
          `This can confuse keyboard users.`,
        fix: `Use tabIndex={0} to follow natural DOM order, or restructure the DOM.`,
      });
    }

    // Check 4: Disabled element that's still tabbable
    if (el.disabled && el.tabIndex !== undefined && el.tabIndex >= 0) {
      issues.push({
        severity: 'warning',
        element: el.identifier,
        message:
          `Element is disabled but still has tabIndex=${el.tabIndex}. ` +
          `Users can Tab to it but can't interact with it.`,
        fix: `Remove tabIndex or set tabIndex={-1} on disabled elements.`,
      });
    }

    // Check 5: Interactive element without accessible label
    if (el.hasClickHandler && !el.disabled && !el.hasAriaLabel) {
      issues.push({
        severity: 'warning',
        element: el.identifier,
        message:
          `Interactive element has no aria-label or aria-labelledby.`,
        fix: `Add aria-label="descriptive text" for screen reader users.`,
      });
    }
  }

  return issues;
}

/**
 * Convenience: returns true only if zero issues are found.
 */
export function validateTabOrder(elements: ElementDescriptor[]): boolean {
  return getA11yIssues(elements).length === 0;
}
