import { ApiProperty } from '@nestjs/swagger';

export class VendorNotificationHistoryItemDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  escrowId!: string;

  @ApiProperty({ example: 'DELIVERY_CONFIRMATION' })
  type!: string;

  @ApiProperty({ example: 'EMAIL' })
  channel!: string;

  @ApiProperty({ example: 'SENT' })
  status!: string;

  @ApiProperty({ example: 1 })
  attemptCount!: number;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z', nullable: true })
  sentAt!: Date | null;

  @ApiProperty({ example: null, nullable: true })
  failedAt!: Date | null;

  @ApiProperty({ example: '2026-11-20T09:55:00.000Z' })
  createdAt!: Date;
}

export class VendorNotificationHistoryPaginatedResponseDto {
  @ApiProperty({ type: [VendorNotificationHistoryItemDto] })
  data!: VendorNotificationHistoryItemDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNextPage!: boolean;
}
