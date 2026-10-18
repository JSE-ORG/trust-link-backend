/**
 * Sentinel description used to reliably identify placeholder vendor profiles
 * created by EscrowService.ensureVendorProfile (issue #937).
 *
 * When a vendor creates an escrow before registering a profile, a minimal placeholder
 * row is created so the foreign key constraint holds. Setting this sentinel description
 * allows VendorProfileService.createProfile to reliably distinguish a placeholder from
 * a real completed profile (without guessing based on businessName), allowing POST
 * /vendor/profile to complete the placeholder with 201 Created while preserving 409 Conflict
 * for completed profiles.
 */
export const VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION = '[placeholder]';
