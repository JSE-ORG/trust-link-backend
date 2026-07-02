import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { EventReplayService } from './event-replay.service';
import { ConfigService } from '../config/config.service';
import { StellarWebhookService } from '../webhooks/stellar-webhook.service';
import { CursorService } from './cursor.service';
import { StellarWebhookDto } from '../webhooks/dto/stellar-webhook.dto';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EventReplayService', () => {
  let service: EventReplayService;
  let configService: jest.Mocked<ConfigService>;
  let webhookService: jest.Mocked<StellarWebhookService>;
  let cursorService: jest.Mocked<CursorService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockReturnValue('TESTNET'),
    } as unknown as jest.Mocked<ConfigService>;

    webhookService = {
      processOperationDto: jest.fn().mockResolvedValue({ processed: true }),
    } as unknown as jest.Mocked<StellarWebhookService>;

    cursorService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CursorService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventReplayService,
        { provide: ConfigService, useValue: configService },
        { provide: StellarWebhookService, useValue: webhookService },
        { provide: CursorService, useValue: cursorService },
      ],
    }).compile();

    service = module.get(EventReplayService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('processes replayed operations and passes typed StellarWebhookDto', async () => {
      const records = [
        {
          id: '100',
          type: 'payment',
          transaction_hash: 'abc123',
          to: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          amount: '100.0000000',
          asset_code: 'USDC',
          paging_token: '100',
        },
      ];

      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      await service.onModuleInit();

      expect(webhookService.processOperationDto).toHaveBeenCalledTimes(1);

      const dto: StellarWebhookDto = webhookService.processOperationDto.mock.calls[0][0];
      expect(dto.id).toBe('100');
      expect(dto.type).toBe('payment');
      expect(dto.transaction_hash).toBe('abc123');
      expect(dto.to).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
      expect(dto.amount).toBe('100.0000000');
      expect(dto.asset_code).toBe('USDC');
    });

    it('persists cursor after processing records', async () => {
      const records = [
        { id: '200', type: 'payment', transaction_hash: 'tx200', paging_token: '200' },
        { id: '201', type: 'payment', transaction_hash: 'tx201', paging_token: '201' },
      ];

      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      await service.onModuleInit();

      expect(cursorService.set).toHaveBeenCalledWith('201');
    });

    it('uses existing cursor in the request URL', async () => {
      cursorService.get.mockResolvedValue('99');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      await service.onModuleInit();

      const url: string = (mockedAxios.get as jest.Mock).mock.calls[0][0];
      expect(url).toContain('cursor=99');
    });

    it('falls back to record id when paging_token is absent', async () => {
      const records = [{ id: '300', type: 'create_account', transaction_hash: 'tx300' }];
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      await service.onModuleInit();

      expect(cursorService.set).toHaveBeenCalledWith('300');
    });

    it('does not persist cursor when no records are returned', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      await service.onModuleInit();

      expect(cursorService.set).not.toHaveBeenCalled();
    });

    it('continues processing remaining records when one fails', async () => {
      const records = [
        { id: '400', type: 'payment', transaction_hash: 'tx400', paging_token: '400' },
        { id: '401', type: 'payment', transaction_hash: 'tx401', paging_token: '401' },
      ];

      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      webhookService.processOperationDto
        .mockRejectedValueOnce(new Error('processing error'))
        .mockResolvedValueOnce({ processed: true });

      await service.onModuleInit();

      expect(webhookService.processOperationDto).toHaveBeenCalledTimes(2);
      expect(cursorService.set).toHaveBeenCalledWith('401');
    });

    it('does not throw when the Horizon request fails', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('network error'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(webhookService.processOperationDto).not.toHaveBeenCalled();
    });

    it('uses MAINNET horizon URL when STELLAR_NETWORK is MAINNET', async () => {
      configService.get.mockReturnValue('MAINNET');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      await service.onModuleInit();

      const url: string = (mockedAxios.get as jest.Mock).mock.calls[0][0];
      expect(url).toContain('horizon.stellar.org');
      expect(url).not.toContain('testnet');
    });
  });
});
