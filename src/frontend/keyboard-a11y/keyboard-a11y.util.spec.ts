/**
 * Unit tests for keyboard accessibility utilities.
 *
 * Tests cover:
 *  AC: All interactive elements reachable via Tab key (tab-order validation)
 *  AC: Visible focus ring on all focused elements (focus-ring validation)
 *  AC: Modals trap focus and restore focus on close (focus-trap)
 *  AC: Report filed listing issues found and fixed (getA11yIssues output)
 */

import {
  validateFocusRing,
  focusRingStyles,
  ANTI_PATTERN_OUTLINE_NONE,
  remediateFocusRing,
  type FocusStyles,
} from './focus-ring.util';

import {
  getA11yIssues,
  validateTabOrder,
  type ElementDescriptor,
} from './tab-order.util';

import { createFocusTrap, type FocusDriver } from './focus-trap.util';

// ═══════════════════════════════════════════════════════════════════════════
// Focus Ring Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('validateFocusRing()', () => {
  it('passes when outline is a visible value (e.g. "2px solid blue")', () => {
    const result = validateFocusRing({ outline: '2px solid blue' });
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('passes when no outline property is set (browser default)', () => {
    const result = validateFocusRing({});
    expect(result.isValid).toBe(true);
  });

  it('passes when outline is undefined', () => {
    const result = validateFocusRing({ outline: undefined });
    expect(result.isValid).toBe(true);
  });

  it('FAILS when outline is "none" with no replacement', () => {
    const result = validateFocusRing({ outline: 'none' });
    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatch(/outline.*none/i);
  });

  it('FAILS when outline is "0" with no replacement', () => {
    const result = validateFocusRing({ outline: '0' });
    expect(result.isValid).toBe(false);
  });

  it('FAILS when outline is "0px" with no replacement', () => {
    const result = validateFocusRing({ outline: '0px' });
    expect(result.isValid).toBe(false);
  });

  it('passes when outline is "none" BUT box-shadow provides visibility', () => {
    const result = validateFocusRing({
      outline: 'none',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.5)',
    });
    expect(result.isValid).toBe(true);
  });

  it('passes when outline is "none" BUT border provides visibility', () => {
    const result = validateFocusRing({
      outline: 'none',
      border: '2px solid blue',
    });
    expect(result.isValid).toBe(true);
  });

  it('passes when outline is "none" BUT borderColor provides visibility', () => {
    const result = validateFocusRing({
      outline: 'none',
      borderColor: '#3b82f6',
    });
    expect(result.isValid).toBe(true);
  });

  it('FAILS when outline is "none" and box-shadow is also "none"', () => {
    const result = validateFocusRing({
      outline: 'none',
      boxShadow: 'none',
    });
    expect(result.isValid).toBe(false);
  });

  it('handles case-insensitive outline values', () => {
    const result = validateFocusRing({ outline: 'NONE' });
    expect(result.isValid).toBe(false);
  });

  it('handles whitespace in outline values', () => {
    const result = validateFocusRing({ outline: '  none  ' });
    expect(result.isValid).toBe(false);
  });
});

describe('focusRingStyles', () => {
  it('provides a visible outline (not "none")', () => {
    expect(focusRingStyles.outline).toBeTruthy();
    expect(focusRingStyles.outline).not.toBe('none');
  });

  it('includes outlineOffset for spacing', () => {
    expect(focusRingStyles.outlineOffset).toBeTruthy();
  });

  it('includes boxShadow as a fallback', () => {
    expect(focusRingStyles.boxShadow).toBeTruthy();
  });

  it('passes its own validation', () => {
    const result = validateFocusRing(focusRingStyles);
    expect(result.isValid).toBe(true);
  });
});

describe('ANTI_PATTERN_OUTLINE_NONE', () => {
  it('fails validation (this IS the anti-pattern)', () => {
    const result = validateFocusRing(ANTI_PATTERN_OUTLINE_NONE);
    expect(result.isValid).toBe(false);
  });
});

describe('remediateFocusRing()', () => {
  it('replaces outline:none with a visible focus ring', () => {
    const fixed = remediateFocusRing({ outline: 'none' });
    expect(fixed.outline).toBe(focusRingStyles.outline);
    expect(fixed.boxShadow).toBe(focusRingStyles.boxShadow);
  });

  it('remediated styles pass validation', () => {
    const fixed = remediateFocusRing({ outline: 'none' });
    const result = validateFocusRing(fixed);
    expect(result.isValid).toBe(true);
  });

  it('preserves other properties from the original', () => {
    const original: FocusStyles = {
      outline: 'none',
      color: 'red',
      backgroundColor: 'white',
    };
    const fixed = remediateFocusRing(original);
    // Overridden by focusRingStyles
    expect(fixed.outline).toBe(focusRingStyles.outline);
    // Preserved from original
    expect(fixed.color).toBe('red');
    expect(fixed.backgroundColor).toBe('white');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tab Order Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('getA11yIssues()', () => {
  const goodButton: ElementDescriptor = {
    tagName: 'button',
    hasClickHandler: true,
    disabled: false,
    identifier: '#submit-btn',
    hasAriaLabel: true,
  };

  const goodLink: ElementDescriptor = {
    tagName: 'a',
    hasClickHandler: true,
    disabled: false,
    identifier: '#nav-link',
    hasAriaLabel: true,
  };

  it('returns no issues for a properly configured button', () => {
    const issues = getA11yIssues([goodButton]);
    expect(issues).toHaveLength(0);
  });

  it('returns no issues for a properly configured link', () => {
    const issues = getA11yIssues([goodLink]);
    expect(issues).toHaveLength(0);
  });

  it('flags a <div> with onClick but no tabIndex as an ERROR', () => {
    const badDiv: ElementDescriptor = {
      tagName: 'div',
      hasClickHandler: true,
      disabled: false,
      identifier: '.card-clickable',
      hasAriaLabel: true,
    };
    const issues = getA11yIssues([badDiv]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(
      errors.some((e) => e.message.includes('not keyboard-reachable')),
    ).toBe(true);
  });

  it('flags a <div> with onClick but no role as an ERROR', () => {
    const noRole: ElementDescriptor = {
      tagName: 'div',
      tabIndex: 0,
      hasClickHandler: true,
      disabled: false,
      identifier: '.card-no-role',
      hasAriaLabel: true,
    };
    const issues = getA11yIssues([noRole]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('no ARIA role'))).toBe(true);
  });

  it('accepts a <div> with onClick, tabIndex=0, and role="button"', () => {
    const goodDiv: ElementDescriptor = {
      tagName: 'div',
      tabIndex: 0,
      hasClickHandler: true,
      disabled: false,
      role: 'button',
      identifier: '.card-accessible',
      hasAriaLabel: true,
    };
    const issues = getA11yIssues([goodDiv]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('warns about tabIndex > 0 (disrupts natural order)', () => {
    const highTabIndex: ElementDescriptor = {
      tagName: 'button',
      tabIndex: 5,
      hasClickHandler: true,
      disabled: false,
      identifier: '#priority-btn',
      hasAriaLabel: true,
    };
    const issues = getA11yIssues([highTabIndex]);
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('natural DOM order'))).toBe(
      true,
    );
  });

  it('warns about disabled elements that are still tabbable', () => {
    const disabledTabbable: ElementDescriptor = {
      tagName: 'button',
      tabIndex: 0,
      hasClickHandler: true,
      disabled: true,
      identifier: '#disabled-btn',
      hasAriaLabel: true,
    };
    const issues = getA11yIssues([disabledTabbable]);
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('disabled'))).toBe(true);
  });

  it('warns about interactive elements without aria-label', () => {
    const noLabel: ElementDescriptor = {
      tagName: 'button',
      hasClickHandler: true,
      disabled: false,
      identifier: '#icon-btn',
      hasAriaLabel: false,
    };
    const issues = getA11yIssues([noLabel]);
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('aria-label'))).toBe(true);
  });

  it('does NOT flag disabled non-native elements without tabIndex', () => {
    const disabledDiv: ElementDescriptor = {
      tagName: 'div',
      hasClickHandler: true,
      disabled: true,
      identifier: '.disabled-card',
      hasAriaLabel: true,
    };
    // disabled=true means the click handler check skips it
    const issues = getA11yIssues([disabledDiv]);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

describe('validateTabOrder()', () => {
  it('returns true when all elements pass', () => {
    const elements: ElementDescriptor[] = [
      {
        tagName: 'button',
        hasClickHandler: true,
        disabled: false,
        identifier: '#btn',
        hasAriaLabel: true,
      },
      {
        tagName: 'input',
        hasClickHandler: false,
        disabled: false,
        identifier: '#input',
        hasAriaLabel: true,
      },
    ];
    expect(validateTabOrder(elements)).toBe(true);
  });

  it('returns false when any element has an issue', () => {
    const elements: ElementDescriptor[] = [
      {
        tagName: 'div',
        hasClickHandler: true,
        disabled: false,
        identifier: '.bad-div',
        hasAriaLabel: true,
      },
    ];
    expect(validateTabOrder(elements)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Focus Trap (using pure-logic Mock Driver)
// ═══════════════════════════════════════════════════════════════════════════

describe('createFocusTrap() with Mock Driver', () => {
  let mockDriver: FocusDriver;
  let focusableElements: Element[];
  let activeElement: Element | null;
  let eventListeners: Record<string, ((e: Event) => void)[]>;

  beforeEach(() => {
    focusableElements = [{ id: 'btn1' }, { id: 'btn2' }, { id: 'btn3' }] as unknown as Element[];
    activeElement = { id: 'outside' } as unknown as Element;
    eventListeners = {};

    mockDriver = {
      getFocusableElements: jest.fn(() => focusableElements),
      getActiveElement: jest.fn(() => activeElement),
      focusElement: jest.fn((el) => {
        activeElement = el;
      }),
      preventDefault: jest.fn(),
      addEventListener: jest.fn((name, handler) => {
        if (!eventListeners[name]) eventListeners[name] = [];
        eventListeners[name].push(handler);
      }),
      removeEventListener: jest.fn((name, handler) => {
        if (eventListeners[name]) {
          eventListeners[name] = eventListeners[name].filter(
            (h) => h !== handler,
          );
        }
      }),
    };
  });

  it('isActive() returns false before activation', () => {
    const trap = createFocusTrap(mockDriver);
    expect(trap.isActive()).toBe(false);
  });

  it('isActive() returns true after activation', () => {
    const trap = createFocusTrap(mockDriver);
    trap.activate();
    expect(trap.isActive()).toBe(true);
  });

  it('focuses the first element on activation', () => {
    const trap = createFocusTrap(mockDriver);
    trap.activate();
    expect(activeElement).toBe(focusableElements[0]);
  });

  it('restores focus on deactivation', () => {
    const trap = createFocusTrap(mockDriver);
    const outside = { id: 'outside' } as unknown as Element;
    activeElement = outside;

    trap.activate();
    expect(activeElement).toBe(focusableElements[0]);

    trap.deactivate();
    expect(activeElement).toBe(outside);
  });

  it('wraps Tab from last element to first', () => {
    const trap = createFocusTrap(mockDriver);
    trap.activate();
    activeElement = focusableElements[2]; // Last element

    const tabHandler = eventListeners['keydown'][0];
    const event = { key: 'Tab', shiftKey: false } as unknown as Event;

    tabHandler(event);

    expect(mockDriver.preventDefault).toHaveBeenCalledWith(event);
    expect(activeElement).toBe(focusableElements[0]);
  });

  it('wraps Shift+Tab from first element to last', () => {
    const trap = createFocusTrap(mockDriver);
    trap.activate();
    activeElement = focusableElements[0]; // First element

    const tabHandler = eventListeners['keydown'][0];
    const event = { key: 'Tab', shiftKey: true } as unknown as Event;

    tabHandler(event);

    expect(mockDriver.preventDefault).toHaveBeenCalledWith(event);
    expect(activeElement).toBe(focusableElements[2]);
  });

  it('deactivates on Escape', () => {
    const trap = createFocusTrap(mockDriver);
    trap.activate();

    const handler = eventListeners['keydown'][0];
    handler({ key: 'Escape' } as unknown as Event);

    expect(trap.isActive()).toBe(false);
  });

  it('calls onEscape callback', () => {
    const onEscape = jest.fn();
    const trap = createFocusTrap(mockDriver, onEscape);
    trap.activate();

    const handler = eventListeners['keydown'][0];
    handler({ key: 'Escape' } as unknown as Event);

    expect(onEscape).toHaveBeenCalled();
  });
});
