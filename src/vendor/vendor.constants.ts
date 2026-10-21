/**
 * Vendor-module constants. Centralises defaults and magic values shared
 * across vendor repositories and services.
 */

/**
 * Platform default notification channels for vendors when no
 * VendorTrackingSettings row exists (issue #943).
 */
export const DEFAULT_NOTIFICATION_CHANNELS: readonly string[] = ['EMAIL'];
