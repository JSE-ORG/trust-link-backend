import { Test, TestingModule } from '@nestjs/testing';
import { EscrowRepository } from '../escrow/escrow.repository';
import { ContractService } from './contract.service';
import { ConfigService } from '../config/config.service';
import { SorobanPollerService } from './soroban-poller.service';

describe('SorobanPollerService', () => {
  let service: SorobanPollerService;
  let escrowRepository: jest.Mocked<EscrowRepository>;
  let contractService: jest.Mocked<ContractService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanPollerService,
        {
          provide: EscrowRepository,
          useValue: {
            findById: jest.fn(),
            markDelivered: jest.fn(),
            updateState: jest.fn(),
            findShippedWithTracking: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ContractService,
          useValue: {
            getEvents: jest.fn().mockResolvedValue([]),
            recordDelivery: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('TESTNET'),
          },
        },
      ],
    }).compile();

    service = module.get<SorobanPollerService>(SorobanPollerService);
    escrowRepository = module.get(EscrowRepository);
    contractService = module.get(ContractService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('EscrowDelivered handling (issue #1046)', () => {
    it('moves SHIPPED escrow to DELIVERED on EscrowDelivered event', async () => {
      const escrow = { id: 'escrow-1', state: 'SHIPPED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      // Simulate the syncStateFromChain path via processEvent
      await (service as any).processEvent({
        name: 'EscrowDelivered',
        topics: [],
        payload: { escrow_id: 'escrow-1', delivered_at: '2024-01-01T00:00:00Z' },
        ledger: 100,
        pagingToken: 'token-1',
      });

      expect(escrowRepository.markDelivered).toHaveBeenCalledWith(
        'escrow-1',
        expect.any(Date),
      );
    });

    it('skips Delivered for escrow not in SHIPPED state', async () => {
      const escrow = { id: 'escrow-1', state: 'FUNDED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      await (service as any).processEvent({
        name: 'EscrowDelivered',
        topics: [],
        payload: { escrow_id: 'escrow-1' },
        ledger: 100,
        pagingToken: 'token-1',
      });

      expect(escrowRepository.markDelivered).not.toHaveBeenCalled();
    });
  });

  describe('EscrowCancelled handling (issue #1048)', () => {
    it('handles EscrowCancelled event', async () => {
      const escrow = { id: 'escrow-2', state: 'SHIPPED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      await (service as any).processEvent({
        name: 'EscrowCancelled',
        topics: [],
        payload: { escrow_id: 'escrow-2' },
        ledger: 100,
        pagingToken: 'token-2',
      });

      expect(escrowRepository.updateState).toHaveBeenCalledWith('escrow-2', 'CANCELLED');
    });

    it('skips cancel for terminal escrows', async () => {
      const escrow = { id: 'escrow-2', state: 'RELEASED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      await (service as any).processEvent({
        name: 'EscrowCancelled',
        topics: [],
        payload: { escrow_id: 'escrow-2' },
        ledger: 100,
        pagingToken: 'token-2',
      });

      expect(escrowRepository.updateState).not.toHaveBeenCalled();
    });
  });

  describe('DisputeResolved handling (issue #1048)', () => {
    it('skips DisputeResolved for terminal escrows', async () => {
      const escrow = { id: 'escrow-3', state: 'RELEASED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      await (service as any).processEvent({
        name: 'DisputeResolved',
        topics: [],
        payload: { escrow_id: 'escrow-3' },
        ledger: 100,
        pagingToken: 'token-3',
      });

      // Should not attempt to update terminal escrow
      expect(escrowRepository.updateState).not.toHaveBeenCalled();
    });
  });

  describe('Admin event filtering (issue #1047)', () => {
    it('skips unhandled events without creating DLQ records', async () => {
      // Fee update event has no escrow_id — should be skipped, not dead-lettered
      await (service as any).processEvent({
        name: 'FeeUpdated',
        topics: [],
        payload: { new_fee: '100' },
        ledger: 100,
        pagingToken: 'token-4',
      });

      // No error thrown, no DLQ record created
      expect(escrowRepository.findById).not.toHaveBeenCalled();
    });

    it('skips contract_upgraded events', async () => {
      await (service as any).processEvent({
        name: 'contract_upgraded',
        topics: ['contract_upgraded'],
        payload: {},
        ledger: 100,
        pagingToken: 'token-5',
      });

      expect(escrowRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('tracking_id fallback (issue #1048)', () => {
    it('reads tracking_id from payload', async () => {
      const escrow = { id: 'escrow-4', state: 'SHIPPED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      await (service as any).processEvent({
        name: 'EscrowDelivered',
        topics: [],
        payload: { tracking_id: 'escrow-4', delivered_at: '2024-01-01T00:00:00Z' },
        ledger: 100,
        pagingToken: 'token-6',
      });

      expect(escrowRepository.findById).toHaveBeenCalledWith('escrow-4');
    });

    it('falls back to trackingId when tracking_id is missing', async () => {
      const escrow = { id: 'escrow-5', state: 'SHIPPED' };
      escrowRepository.findById.mockResolvedValue(escrow as any);

      await (service as any).processEvent({
        name: 'EscrowDelivered',
        topics: [],
        payload: { trackingId: 'escrow-5', delivered_at: '2024-01-01T00:00:00Z' },
        ledger: 100,
        pagingToken: 'token-7',
      });

      expect(escrowRepository.findById).toHaveBeenCalledWith('escrow-5');
    });
  });
});
