/**
 * Issue #841 — `/health` did not check the Soroban RPC.
 *
 * Every contract call is submitted through the `rpc.Server` built from
 * `SOROBAN_RPC_URL`, and the readiness probe checked the database, Horizon and
 * Redis only. Health therefore reported `ok` while escrow funding, release and
 * delivery all failed to submit.
 *
 * These tests cover the probe in isolation: no HTTP server, no database.
 */
import { Logger } from '@nestjs/common';
import {
  SorobanHealthService,
  SOROBAN_HEALTH_TIMEOUT_MS,
} from './soroban-health.service';

/** A `getHealth` that resolves with a passing status. */
function healthyServer() {
  return { getHealth: jest.fn().mockResolvedValue({ status: 'pass' }) };
}

describe('SorobanHealthService (#841)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('healthy node', () => {
    it('reports ok when getHealth resolves with status pass', async () => {
      const service = new SorobanHealthService(healthyServer());

      await expect(service.checkHealth()).resolves.toEqual({ status: 'ok' });
    });

    it('calls getHealth on the bound server', async () => {
      const server = healthyServer();
      const service = new SorobanHealthService(server);

      await service.checkHealth();

      expect(server.getHealth).toHaveBeenCalledTimes(1);
    });

    it('does not log an error for a healthy node', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const service = new SorobanHealthService(healthyServer());

      await service.checkHealth();

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('unreachable node', () => {
    it('reports down when getHealth rejects', async () => {
      const server = {
        getHealth: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
      const service = new SorobanHealthService(server);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.checkHealth()).resolves.toEqual({
        status: 'down',
        error: 'ECONNREFUSED',
      });
    });

    it('does not throw when getHealth rejects', async () => {
      const server = {
        getHealth: jest.fn().mockRejectedValue(new Error('fetch failed')),
      };
      const service = new SorobanHealthService(server);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.checkHealth()).resolves.toBeDefined();
    });

    it('reports down when the rejection is not an Error', async () => {
      const server = { getHealth: jest.fn().mockRejectedValue('boom') };
      const service = new SorobanHealthService(server);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await service.checkHealth();

      expect(result.status).toBe('down');
      expect(result.error).toBe('Soroban RPC connection failed');
    });

    it('reports down when getHealth never resolves, without hanging', async () => {
      const server = { getHealth: jest.fn().mockReturnValue(new Promise(() => {})) };
      const service = new SorobanHealthService(server);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await service.checkHealth();

      expect(result.status).toBe('down');
      expect(result.error).toContain(String(SOROBAN_HEALTH_TIMEOUT_MS));
    }, 5000);
  });

  describe('node that answers with a failing status', () => {
    // A node can answer getHealth while being unable to serve contract
    // traffic, so a resolved response is not on its own a healthy one.
    it.each(['fail', 'degraded'])(
      'reports down when the node answers status %s',
      async (status) => {
        const server = { getHealth: jest.fn().mockResolvedValue({ status }) };
        const service = new SorobanHealthService(server);
        jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);

        const result = await service.checkHealth();

        expect(result.status).toBe('down');
        expect(result.error).toContain(status);
      },
    );

    it('reports down when the response carries no status', async () => {
      const server = { getHealth: jest.fn().mockResolvedValue({}) };
      const service = new SorobanHealthService(server);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await service.checkHealth();

      expect(result.status).toBe('down');
      expect(result.error).toContain('no health status');
    });

    it('reports down when the response is not an object', async () => {
      const server = { getHealth: jest.fn().mockResolvedValue(undefined) };
      const service = new SorobanHealthService(server);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await service.checkHealth();

      expect(result.status).toBe('down');
    });
  });

  describe('no server bound', () => {
    it('reports ok when no server is injected', async () => {
      const service = new SorobanHealthService(undefined);

      await expect(service.checkHealth()).resolves.toEqual({ status: 'ok' });
    });

    it('reports ok when the bound server has no getHealth', async () => {
      const service = new SorobanHealthService({} as never);

      await expect(service.checkHealth()).resolves.toEqual({ status: 'ok' });
    });
  });
});
