import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { EventReplayService } from './event-replay.service';
import { ConfigService } from '../config/config.service';
import { StellarWebhookService } from '../webhooks/stellar-webhook.service';
import { CursorService } from './cursor.service';
import { HorizonService } from './horizon.service';
import { StellarWebhookDto } from '../webhooks/dto/stellar-webhook.dto';
import { TracingService } from '../tracing/tracing.service';
import { createTracingMock } from '../../test/unit/tracing-mock';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('EventReplayService', () => {
  let webhookService: jest.Mocked<StellarWebhookService>;
  let cursorService: jest.Mocked<CursorService>;
  let tracing: ReturnType<typeof createTracingMock>['service'];

  /**
   * Build the service under test. Issue #920 made the Horizon base URL come
   * from `HorizonService`, so the config is handed to a real `HorizonService`
   * (which resolves the URL exactly as production does) rather than to the
   * replay service itself.
   */
  async function buildService(
    values: Record<string, string | undefined> = {},
  ): Promise<EventReplayService> {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: TracingService, useValue: tracing },
        EventReplayService,
        { provide: StellarWebhookService, useValue: webhookService },
        { provide: CursorService, useValue: cursorService },
        {
          provide: HorizonService,
          useValue: new HorizonService(config, tracing),
        },
      ],
    }).compile();

    return module.get(EventReplayService);
  }

  beforeEach(() => {
    tracing = createTracingMock().service;

    webhookService = {
      processOperationDto: jest.fn().mockResolvedValue({ processed: true }),
    } as unknown as jest.Mocked<StellarWebhookService>;

    cursorService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CursorService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', async () => {
    const service = await buildService();
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

      const service = await buildService();
      await service.onModuleInit();

      expect(webhookService.processOperationDto).toHaveBeenCalledTimes(1);

      const dto: StellarWebhookDto =
        webhookService.processOperationDto.mock.calls[0][0];
      expect(dto.id).toBe('100');
      expect(dto.type).toBe('payment');
      expect(dto.transaction_hash).toBe('abc123');
      expect(dto.to).toBe(
        'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );
      expect(dto.amount).toBe('100.0000000');
      expect(dto.asset_code).toBe('USDC');
    });

    it('persists cursor after processing records', async () => {
      const records = [
        {
          id: '200',
          type: 'payment',
          transaction_hash: 'tx200',
          paging_token: '200',
        },
        {
          id: '201',
          type: 'payment',
          transaction_hash: 'tx201',
          paging_token: '201',
        },
      ];

      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      const service = await buildService();
      await service.onModuleInit();

      expect(cursorService.set).toHaveBeenCalledWith('201');
    });

    it('uses existing cursor in the request URL', async () => {
      cursorService.get.mockResolvedValue('99');
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      const service = await buildService();
      await service.onModuleInit();

      const url: string = (mockedAxios.get as jest.Mock).mock.calls[0][0];
      expect(url).toContain('cursor=99');
    });

    it('falls back to record id when paging_token is absent', async () => {
      const records = [
        { id: '300', type: 'create_account', transaction_hash: 'tx300' },
      ];
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      const service = await buildService();
      await service.onModuleInit();

      expect(cursorService.set).toHaveBeenCalledWith('300');
    });

    it('does not persist cursor when no records are returned', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      const service = await buildService();
      await service.onModuleInit();

      expect(cursorService.set).not.toHaveBeenCalled();
    });

    it('continues processing remaining records when one fails', async () => {
      const records = [
        {
          id: '400',
          type: 'payment',
          transaction_hash: 'tx400',
          paging_token: '400',
        },
        {
          id: '401',
          type: 'payment',
          transaction_hash: 'tx401',
          paging_token: '401',
        },
      ];

      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records } },
      });

      webhookService.processOperationDto
        .mockRejectedValueOnce(new Error('processing error'))
        .mockResolvedValueOnce({ processed: true });

      const service = await buildService();
      await service.onModuleInit();

      expect(webhookService.processOperationDto).toHaveBeenCalledTimes(2);
      expect(cursorService.set).toHaveBeenCalledWith('401');
    });

    it('defaults to TESTNET horizon URL when STELLAR_NETWORK is not configured', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      const service = await buildService();
      await service.onModuleInit();

      const url: string = (mockedAxios.get as jest.Mock).mock.calls[0][0];
      expect(url).toContain('horizon-testnet.stellar.org');
      expect(url).not.toContain('horizon.stellar.org/');
    });

    it('completes without error and replays nothing when the response has no _embedded property', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({ data: {} });

      const service = await buildService();
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(webhookService.processOperationDto).not.toHaveBeenCalled();
      expect(cursorService.set).not.toHaveBeenCalled();
    });

    it('does not throw when the Horizon request fails', async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error('network error'));

      const service = await buildService();
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(webhookService.processOperationDto).not.toHaveBeenCalled();
    });

    it('uses MAINNET horizon URL when STELLAR_NETWORK is MAINNET', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      const service = await buildService({ STELLAR_NETWORK: 'MAINNET' });
      await service.onModuleInit();

      const url: string = (mockedAxios.get as jest.Mock).mock.calls[0][0];
      expect(url).toContain('horizon.stellar.org');
      expect(url).not.toContain('testnet');
    });

    it('requests STELLAR_HORIZON_URL when it is configured (issue #920)', async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: { _embedded: { records: [] } },
      });

      const service = await buildService({
        STELLAR_NETWORK: 'MAINNET',
        STELLAR_HORIZON_URL: 'https://horizon.internal.example',
      });
      await service.onModuleInit();

      const url: string = (mockedAxios.get as jest.Mock).mock.calls[0][0];
      expect(url).toContain('https://horizon.internal.example/operations');
      expect(url).not.toContain('horizon.stellar.org');
    });
  });
});
