/**
 * Sentinel description used to reliably identify placeholder vendor profiles
 * created by EscrowService.ensureVendorProfile (issue #937).
 *
 * When a vendor creates an escrow before registering a profile, a minimal placeholder
 * row is created so the foreign key constraint holds. The sentinel description marks
 * placeholders, including legacy rows backfilled by migration. It must not be accepted
 * as a vendor-supplied description.
 */
export const VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION = '[placeholder]';
