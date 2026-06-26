/**
 * Raw response types returned by the GIGL logistics provider API.
 *
 * These types intentionally mirror the external wire format (snake_case,
 * nullable strings for dates) so that tests can assert the exact schema
 * the adapter must handle.
 */

/** A single shipment event as returned by the GIGL tracking endpoint. */
export interface GiglTrackingEvent {
  /** ISO-8601 timestamp string, e.g. "2024-03-15T10:30:00Z" */
  event_time: string;
  /**
   * Provider-level status code.
   * Known values: "DELIVERED", "IN_TRANSIT", "OUT_FOR_DELIVERY",
   * "PICKUP", "EXCEPTION", "INFO"
   */
  event_code: string;
  /** Physical location description, or null if unavailable. */
  location: string | null;
  /** Human-readable description of the event. */
  description: string;
}

/** Top-level response payload from `GET /tracking/{trackingNumber}`. */
export interface GiglTrackingResponse {
  /** The tracking number echoed back by the API. */
  tracking_number: string;
  /**
   * Current overall shipment status.
   * One of: "DELIVERED", "IN_TRANSIT", "PENDING"
   */
  current_status: string;
  /** GIGL carrier code, e.g. "GIGL-EXPRESS". */
  carrier_code: string;
  /**
   * Estimated delivery date as an ISO-8601 string, or null when unknown.
   */
  estimated_delivery: string | null;
  /** Ordered list of tracking events, newest last. */
  events: GiglTrackingEvent[];
}
