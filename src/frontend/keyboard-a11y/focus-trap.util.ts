/**
 * Focus Driver Interface
 *
 * Abstracting the DOM interactions allows the focus trap logic to be tested
 * in a pure-logic environment (no jsdom needed) while remaining fully
 * functional in a real browser.
 */
export interface FocusDriver {
  getFocusableElements: () => any[];
  getActiveElement: () => any;
  focusElement: (el: any) => void;
  preventDefault: (event: any) => void;
  addEventListener: (name: string, handler: (e: any) => void) => void;
  removeEventListener: (name: string, handler: (e: any) => void) => void;
}

/** CSS selector matching all natively focusable / tabbable elements. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * Default DOM driver for use in a real browser context.
 */
export const createDomDriver = (container: Element): FocusDriver => ({
  getFocusableElements: () => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)),
  getActiveElement: () => document.activeElement,
  focusElement: (el: HTMLElement) => el.focus(),
  preventDefault: (e: any) => e.preventDefault(),
  addEventListener: (name, handler) => container.addEventListener(name, handler),
  removeEventListener: (name, handler) => container.removeEventListener(name, handler),
});

/**
 * Configuration returned by `createFocusTrap`.
 * Call `activate()` to start trapping and `deactivate()` to release.
 */
export interface FocusTrap {
  /** Start trapping Tab/Shift+Tab within the container. */
  activate: () => void;
  /** Stop trapping and restore focus to the previously focused element. */
  deactivate: () => void;
  /** Whether the trap is currently active. */
  isActive: () => boolean;
}

/**
 * Creates a focus trap that wraps focus from first <-> last element.
 *
 * @param driver — The focus driver (use createDomDriver(el) for real DOM).
 * @param onEscape — Optional callback invoked when Escape is pressed.
 */
export function createFocusTrap(
  driver: FocusDriver,
  onEscape?: () => void,
): FocusTrap {
  let active = false;
  let previouslyFocused: any = null;

  function handleKeyDown(event: any) {
    if (event.key === 'Escape') {
      deactivate();
      onEscape?.();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = driver.getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (driver.getActiveElement() === first) {
        driver.preventDefault(event);
        driver.focusElement(last);
      }
    } else {
      if (driver.getActiveElement() === last) {
        driver.preventDefault(event);
        driver.focusElement(first);
      }
    }
  }

  function activate() {
    if (active) return;
    active = true;
    previouslyFocused = driver.getActiveElement();
    driver.addEventListener('keydown', handleKeyDown);

    const focusable = driver.getFocusableElements();
    if (focusable.length > 0) {
      driver.focusElement(focusable[0]);
    }
  }

  function deactivate() {
    if (!active) return;
    active = false;
    driver.removeEventListener('keydown', handleKeyDown);

    if (previouslyFocused) {
      driver.focusElement(previouslyFocused);
    }
    previouslyFocused = null;
  }

  return {
    activate,
    deactivate,
    isActive: () => active,
  };
}
