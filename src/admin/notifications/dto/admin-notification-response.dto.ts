import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminNotificationItemDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174001' })
  escrowId!: string;

  @ApiProperty({ example: 'DELIVERY_CONFIRMATION' })
  type!: string;

  @ApiProperty({ example: 'EMAIL' })
  channel!: string;

  @ApiProperty({ example: 'FAILED' })
  status!: string;

  @ApiProperty({ example: 3 })
  retryCount!: number;

  @ApiProperty({ example: 3 })
  attemptCount!: number;

  @ApiPropertyOptional({ example: 'Connection reset by peer', nullable: true })
  lastError!: string | null;

  @ApiPropertyOptional({ example: 500, nullable: true })
  lastResponseCode!: number | null;

  @ApiPropertyOptional({ example: 'msg_12345', nullable: true })
  providerMessageId!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  sentAt!: Date | null;

  @ApiPropertyOptional({ example: '2026-11-20T10:00:00.000Z', nullable: true })
  failedAt!: Date | null;

  @ApiProperty({ example: '2026-11-20T09:50:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-11-20T10:00:00.000Z' })
  updatedAt!: Date;
}

export class AdminNotificationsPaginatedResponseDto {
  @ApiProperty({ type: [AdminNotificationItemDto] })
  data!: AdminNotificationItemDto[];

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
