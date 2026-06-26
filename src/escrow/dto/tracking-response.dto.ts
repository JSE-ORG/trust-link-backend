export interface TrackingEvent {
  timestamp: Date;
  status: string;
  location?: string;
  description: string;
}

export interface TrackingResponseDto {
  status: string;
  estimatedDelivery?: Date;
  carrier?: string;
  events: TrackingEvent[];
}
