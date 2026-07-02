import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BuyerDisputeService } from '../../src/escrow/buyer-dispute.service';
import { EscrowRepository } from '../../src/escrow/escrow.repository';
import { DisputeRepository } from '../../src/dispute/dispute.repository';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { S3PresignService } from '../../src/common/services/s3-presign.service';
import { ConfigService } from '../../src/config/config.service';
import type { EscrowRecord } from '../../src/prisma/prisma.service';
import type { DisputeRecord } from '../../src/prisma/prisma.service';
import { DisputeReasonCategory } from '../../src/escrow/dto/open-dispute.dto';

// ── fixtures ──────────────────────────────────────────────────────────────────

const BUYER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const VENDOR = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGKWI7MYCX8YGZS7FCZUEX';
const ADMIN = 'GADMIN7IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const shippedEscrow: EscrowRecord = {
  id: 'escrow-abc',
  itemName: 'Sony A7 IV',
  itemRef: 'SKU-CAM-001',
  amount: 2499.99,
  currency: 'USDC',
  buyerAddress: BUYER,
  vendorAddress: VENDOR,
  state: 'SHIPPED',
  trackingId: 'TRK-001',
  shippedAt: new Date('2026-01-10T00:00:00.000Z'),
  deliveredAt: null,
  deliveryRecordedAt: null,
  autoReleaseSubmittedAt: null,
  autoReleaseTxHash: null,
  disputeId: null,
  cancelledAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-10T00:00:00.000Z'),
};

const openDisputeDto = {
  reason: DisputeReasonCategory.ITEM_NOT_AS_DESCRIBED,
  description: 'The camera arrived with a cracked LCD screen.',
  evidenceUrls: ['https://evidence.trustlink.io/photo-1.jpg'],
};

const createdDispute: DisputeRecord = {
  id: 'dispute-xyz',
  escrowId: 'escrow-abc',
  reason: DisputeReasonCategory.ITEM_NOT_AS_DESCRIBED,
  description: 'The camera arrived with a cracked LCD screen.',
  evidenceUrls: ['https://evidence.trustlink.io/photo-1.jpg'],
  status: 'OPEN',
  resolvedAt: null,
  createdAt: new Date('2026-01-15T00:00:00.000Z'),
  updatedAt: new Date('2026-01-15T00:00:00.000Z'),
};

// ── tests ──────────────────────────────────────────────────────────────────────

describe('BuyerDisputeService.openDispute (issue #41)', () => {
  let service: BuyerDisputeService;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let disputeRepository: jest.Mocked<DisputeRepository>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let s3PresignService: jest.Mocked<S3PresignService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyerDisputeService,
        {
          provide: EscrowRepository,
          useValue: {
            findById: jest.fn(),
          },
        },
        {
          provide: DisputeRepository,
          useValue: {
            create: jest.fn(),
            findByEscrow: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyDisputed: jest.fn().mockResolvedValue(undefined),
            notifyDisputedAdmin: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: S3PresignService,
          useValue: {
            presignAll: jest.fn((urls: string[]) => urls),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ADMIN_ADDRESS') return ADMIN;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(BuyerDisputeService);
    escrowRepository = module.get(EscrowRepository);
    disputeRepository = module.get(DisputeRepository);
    notificationsService = module.get(NotificationsService);
    s3PresignService = module.get(S3PresignService);
    configService = module.get(ConfigService);
  });

  describe('success path', () => {
    it('creates a dispute and returns a formatted response', async () => {
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockResolvedValue(createdDispute);

      const result = await service.openDispute(
        'escrow-abc',
        BUYER,
        openDisputeDto,
      );

      expect(escrowRepository.findById).toHaveBeenCalledWith('escrow-abc');
      expect(disputeRepository.create).toHaveBeenCalledWith({
        escrowId: 'escrow-abc',
        reason: openDisputeDto.reason,
        description: openDisputeDto.description,
        evidenceUrls: openDisputeDto.evidenceUrls,
      });
      expect(result.id).toBe('dispute-xyz');
      expect(result.escrowId).toBe('escrow-abc');
      expect(result.status).toBe('OPEN');
      expect(result.reason).toBe(DisputeReasonCategory.ITEM_NOT_AS_DESCRIBED);
    });

    it('notifies vendor channel and admin channel on dispute creation', async () => {
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockResolvedValue(createdDispute);

      await service.openDispute('escrow-abc', BUYER, openDisputeDto);

      expect(notificationsService.notifyDisputed).toHaveBeenCalledWith(
        shippedEscrow,
      );
      expect(notificationsService.notifyDisputedAdmin).toHaveBeenCalledWith(
        shippedEscrow,
        ADMIN,
      );
    });

    it('allows vendor to open dispute on their own escrow', async () => {
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockResolvedValue(createdDispute);

      const result = await service.openDispute(
        'escrow-abc',
        VENDOR,
        openDisputeDto,
      );

      expect(result.id).toBe('dispute-xyz');
    });

    it('allows admin to open a dispute', async () => {
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockResolvedValue(createdDispute);

      const result = await service.openDispute(
        'escrow-abc',
        ADMIN,
        openDisputeDto,
      );

      expect(result.id).toBe('dispute-xyz');
    });

    it('applies presigned URLs to evidence returned in response', async () => {
      const presigned = ['https://cdn.trustlink.io/presigned/photo-1.jpg'];
      s3PresignService.presignAll.mockReturnValue(presigned);
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockResolvedValue(createdDispute);

      const result = await service.openDispute(
        'escrow-abc',
        BUYER,
        openDisputeDto,
      );

      expect(s3PresignService.presignAll).toHaveBeenCalledWith(
        createdDispute.evidenceUrls,
      );
      expect(result.evidenceUrls).toEqual(presigned);
    });

    it('handles missing optional evidenceUrls by defaulting to empty array', async () => {
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockResolvedValue({
        ...createdDispute,
        evidenceUrls: [],
      });
      s3PresignService.presignAll.mockReturnValue([]);

      const dtoWithoutEvidence = { ...openDisputeDto, evidenceUrls: undefined };
      const result = await service.openDispute(
        'escrow-abc',
        BUYER,
        dtoWithoutEvidence,
      );

      expect(disputeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ evidenceUrls: [] }),
      );
      expect(result.evidenceUrls).toEqual([]);
    });
  });

  describe('error boundaries', () => {
    it('throws NotFoundException when escrow does not exist', async () => {
      escrowRepository.findById.mockResolvedValue(null);

      await expect(
        service.openDispute('missing-id', BUYER, openDisputeDto),
      ).rejects.toThrow(NotFoundException);

      expect(disputeRepository.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller is not a participant', async () => {
      const outsider =
        'GOUTSIDER7IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLF';
      escrowRepository.findById.mockResolvedValue(shippedEscrow);

      await expect(
        service.openDispute('escrow-abc', outsider, openDisputeDto),
      ).rejects.toThrow(ForbiddenException);

      expect(disputeRepository.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when escrow is already in DISPUTED state', async () => {
      const disputedEscrow: EscrowRecord = {
        ...shippedEscrow,
        state: 'DISPUTED',
      };
      escrowRepository.findById.mockResolvedValue(disputedEscrow);

      await expect(
        service.openDispute('escrow-abc', BUYER, openDisputeDto),
      ).rejects.toThrow(ConflictException);

      expect(disputeRepository.create).not.toHaveBeenCalled();
    });

    it('does not notify when dispute repository throws', async () => {
      escrowRepository.findById.mockResolvedValue(shippedEscrow);
      disputeRepository.create.mockRejectedValue(new Error('DB error'));

      await expect(
        service.openDispute('escrow-abc', BUYER, openDisputeDto),
      ).rejects.toThrow('DB error');

      expect(notificationsService.notifyDisputed).not.toHaveBeenCalled();
    });
  });
});
