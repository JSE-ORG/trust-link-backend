/**
 * Wire types for the Terminal Africa shipment tracking endpoint
 * (`GET /shipments/track/{shipmentId}`). Fields mirror the provider's
 * snake_case JSON; check them against https://docs.terminal.africa before
 * binding this provider in production.
 */

export interface TerminalAfricaTrackingEvent {
  /** ISO-8601 timestamp. */
  created_at: string;
  /** Provider status, e.g. "in-transit", "delivered". */
  status: string;
  location: string | null;
  description: string;
}

export interface TerminalAfricaTrackingData {
  /** Overall shipment status, e.g. "confirmed", "in-transit", "delivered". */
  status: string;
  carrier: string | null;
  estimated_delivery: string | null;
  events: TerminalAfricaTrackingEvent[];
}

/** Envelope every Terminal Africa response is wrapped in. */
export interface TerminalAfricaTrackingResponse {
  status: boolean;
  message: string;
  data: TerminalAfricaTrackingData;
}
