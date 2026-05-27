import { EscrowState } from '../../prisma/prisma.service';

export class EscrowSummaryDto {
  id!: string;
  itemName!: string;
  itemRef!: string;
  amount!: number;
  currency!: string;
  state!: EscrowState;
  trackingId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
