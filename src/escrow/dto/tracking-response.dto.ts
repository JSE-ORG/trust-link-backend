/**
 * A single tracking event in the shipment history, including timestamp,
 * status, optional location, and a human-readable description.
 */
export interface TrackingEvent {
  timestamp: Date;
  status: string;
  location?: string;
  description: string;
}

/**
 * Response shape for GET /escrow/:id/tracking. Contains the overall
 * shipment status, optional estimated delivery, carrier name, and a
 * chronological list of tracking events.
 */
export interface TrackingResponseDto {
  status: string;
  estimatedDelivery?: Date;
  carrier?: string;
  events: TrackingEvent[];
}
