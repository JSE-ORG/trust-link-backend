import { EscrowState } from '../../prisma/prisma.service';

export class EscrowResponseDto {
  id!: string;
  itemName!: string;
  itemRef!: string;
  amount!: number;
  currency!: string;
  state!: EscrowState;
  trackingId!: string | null;
  shippedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
