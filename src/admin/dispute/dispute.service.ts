import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DisputeRecord,
  DisputeState,
  EscrowRecord,
} from '../../prisma/prisma.service';
import { EscrowRepository } from '../../escrow/escrow.repository';
import { DisputeRepository } from '../../dispute/dispute.repository';
import { ContractService } from '../../stellar/contract.service';
import { ConfigService } from '../../config/config.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly contractService: ContractService,
    private readonly disputeRepository: DisputeRepository,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Returns the contract admin address, or throws.
   *
   * `resolve_dispute` calls `caller.require_auth()` and the contract only
   * accepts an authorised resolver, so this is the address the call has to be
   * made and signed with. Resolved on use rather than in the constructor so an
   * unset value fails this path instead of application boot.
   */
  private requireAdminAddress(): string {
    const address = this.configService.get<string>('ADMIN_ADDRESS');
    if (!address) {
      throw new ConflictException(
        'ADMIN_ADDRESS is not configured; cannot resolve disputes on-chain.',
      );
    }
    return address;
  }

  async getDisputes(query: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: DisputeRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = query.status
      ? { status: query.status as DisputeState }
      : undefined;

    const [data, total] = await Promise.all([
      this.disputeRepository.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.disputeRepository.count(where),
    ]);
    return { data, total, page, limit };
  }

  /** Resolves a dispute by submitting the contract action and finalizing escrow state. */
  async resolve(
    escrowId: string,
    resolution: 'RELEASE' | 'REFUND',
  ): Promise<EscrowRecord> {
    const escrow = await this.escrowRepository.findById(escrowId);
    if (!escrow) {
      throw new NotFoundException('Escrow not found');
    }

    if (escrow.state === 'COMPLETED' || escrow.state === 'REFUNDED') {
      throw new ConflictException('Dispute has already been resolved');
    }

    if (escrow.state !== 'DISPUTED') {
      throw new ConflictException('Escrow is not currently disputed');
    }

    // `resolve_dispute(env, caller: Address, escrow_id: u64, resolution)`
    // addresses the escrow by the contract's own id, and require_auth()s the
    // caller. Without the mapping there is no valid on-chain call to make.
    if (escrow.contractEscrowId === null) {
      throw new ConflictException(
        'Escrow has no contractEscrowId, so the dispute cannot be resolved on-chain.',
      );
    }

    await this.contractService.resolveDispute(
      escrow.contractEscrowId,
      resolution,
      this.requireAdminAddress(),
    );

    const dispute = await this.disputeRepository.findFirst({
      where: {
        escrowId,
        status: { in: ['OPEN', 'UNDER_REVIEW'] as DisputeState[] },
      },
    });
    if (dispute) {
      await this.disputeRepository.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });
    }

    let result: EscrowRecord;
    if (resolution === 'RELEASE') {
      result = await this.escrowRepository.markCompleted(escrowId);
      await this.notifySafely('notifyCompleted', () =>
        this.notificationsService.notifyCompleted(result),
      );
    } else {
      result = await this.escrowRepository.markRefunded(escrowId);
      await this.notifySafely('notifyRefunded', () =>
        this.notificationsService.notifyRefunded(result),
      );
    }
    return result;
  }

  /**
   * The escrow state is already written by the time the notifier runs, so a
   * delivery failure must not roll the request back — it is logged and the
   * resolve still succeeds.
   */
  private async notifySafely(
    label: string,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.error(`${label} failed for resolved dispute`, error);
    }
  }
}
