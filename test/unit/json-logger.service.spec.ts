import { JsonLoggerService } from '../../src/common/logger/json-logger.service';

describe('JsonLoggerService (issue #81)', () => {
  let logger: JsonLoggerService;
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new JsonLoggerService();
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    delete process.env.LOG_LEVEL;
  });

  const lastEntry = (): Record<string, unknown> => {
    const call = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
    return JSON.parse(call[0] as string) as Record<string, unknown>;
  };

  it('emits a JSON line for log()', () => {
    logger.log('hello world', 'TestCtx');
    expect(writeSpy).toHaveBeenCalled();
    const entry = lastEntry();
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello world');
    expect(entry.context).toBe('TestCtx');
    expect(typeof entry.time).toBe('string');
    expect(typeof entry.pid).toBe('number');
  });

  it('emits a JSON line for warn()', () => {
    logger.warn('something off', 'WarnCtx');
    const entry = lastEntry();
    expect(entry.level).toBe('warn');
    expect(entry.msg).toBe('something off');
  });

  it('emits a JSON line for error() and includes stack', () => {
    logger.error('boom', 'Error: boom\n  at test', 'ErrCtx');
    const entry = lastEntry();
    expect(entry.level).toBe('error');
    expect(entry.stack).toContain('Error: boom');
  });

  it('emits a JSON line for debug()', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('debug msg', 'DbgCtx');
    const entry = lastEntry();
    expect(entry.level).toBe('debug');
  });

  it('suppresses debug messages when LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    logger.debug('should be suppressed', 'Ctx');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('structured() includes extra fields in the JSON output', () => {
    logger.structured(
      'log',
      'escrow.created',
      { escrowId: 'e-1', amount: 100 },
      'EscrowCtx',
    );
    const entry = lastEntry();
    expect(entry.msg).toBe('escrow.created');
    expect(entry.escrowId).toBe('e-1');
    expect(entry.amount).toBe(100);
  });

  it('each entry contains pid and env fields', () => {
    logger.log('check fields');
    const entry = lastEntry();
    expect(typeof entry.pid).toBe('number');
    expect(typeof entry.env).toBe('string');
  });
  describe('context fallbacks and missing coverage', () => {
    beforeEach(() => {
      logger.setContext('InstanceCtx');
    });

    it('falls back to instance context for log()', () => {
      logger.log('msg');
      expect(lastEntry().context).toBe('InstanceCtx');
    });

    it('falls back to instance context for warn()', () => {
      logger.warn('msg');
      expect(lastEntry().context).toBe('InstanceCtx');
    });

    it('falls back to instance context for error()', () => {
      logger.error('msg');
      expect(lastEntry().context).toBe('InstanceCtx');
    });

    it('falls back to instance context for debug()', () => {
      process.env.LOG_LEVEL = 'debug';
      logger.debug('msg');
      expect(lastEntry().context).toBe('InstanceCtx');
    });

    it('falls back to instance context for verbose()', () => {
      process.env.LOG_LEVEL = 'trace';
      logger.verbose('msg');
      expect(lastEntry().context).toBe('InstanceCtx');
    });

    it('falls back to instance context for structured()', () => {
      logger.structured('log', 'msg', {});
      expect(lastEntry().context).toBe('InstanceCtx');
    });

    it('uses "App" if neither explicit nor instance context is set', () => {
      const statelessLogger = new JsonLoggerService();
      statelessLogger.log('msg');
      expect(lastEntry().context).toBe('App');
    });

    it('uses "App" for structured() if neither explicit nor instance context is set', () => {
      const statelessLogger = new JsonLoggerService();
      statelessLogger.structured('log', 'msg', {});
      expect(lastEntry().context).toBe('App');
    });

    it('suppresses structured() messages when below LOG_LEVEL', () => {
      process.env.LOG_LEVEL = 'error';
      logger.structured('log', 'msg', {});
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  // ── Issue #732: uncovered ?? fallback branches ───────────────────────────

  describe('unrecognised LOG_LEVEL falls back to info priority (branch 1)', () => {
    let savedLogLevel: string | undefined;

    beforeEach(() => {
      savedLogLevel = process.env.LOG_LEVEL;
    });

    afterEach(() => {
      if (savedLogLevel === undefined) {
        delete process.env.LOG_LEVEL;
      } else {
        process.env.LOG_LEVEL = savedLogLevel;
      }
    });

    it('treats an unknown LOG_LEVEL as info, so info messages are emitted', () => {
      process.env.LOG_LEVEL = 'nonsense';
      logger.log('should appear');
      expect(writeSpy).toHaveBeenCalled();
      expect(lastEntry().level).toBe('info');
    });

    it('treats an unknown LOG_LEVEL as info, so debug messages are suppressed', () => {
      process.env.LOG_LEVEL = 'nonsense';
      logger.debug('should be suppressed');
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('unrecognised level argument falls back to info priority (branch 2)', () => {
    it('treats an unknown level argument as info priority and emits the entry', () => {
      // Call shouldLog indirectly via structured() with a fabricated level string.
      // Cast needed because the public API only accepts LogLevel | 'trace'.
      (logger as unknown as { structured: Function }).structured(
        'unknownlevel' as never,
        'msg',
        {},
        'Ctx',
      );
      expect(writeSpy).toHaveBeenCalled();
      const entry = lastEntry();
      expect(entry.msg).toBe('msg');
    });

    it('unknown level argument is treated as info, so it passes an info-minimum filter', () => {
      process.env.LOG_LEVEL = 'info';
      (logger as unknown as { structured: Function }).structured(
        'unknownlevel' as never,
        'visible',
        {},
        'Ctx',
      );
      expect(writeSpy).toHaveBeenCalled();
    });

    it('unknown level argument is treated as info priority, so it is suppressed by error minimum', () => {
      process.env.LOG_LEVEL = 'error';
      (logger as unknown as { structured: Function }).structured(
        'unknownlevel' as never,
        'hidden',
        {},
        'Ctx',
      );
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('NODE_ENV ?? "development" fallback (branches 3 & 4)', () => {
    let savedNodeEnv: string | undefined;

    beforeEach(() => {
      savedNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
    });

    afterEach(() => {
      if (savedNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = savedNodeEnv;
      }
    });

    it('emit() falls back to "development" when NODE_ENV is unset (branch 3)', () => {
      logger.log('no-env message', 'Ctx');
      expect(writeSpy).toHaveBeenCalled();
      expect(lastEntry().env).toBe('development');
    });

    it('structured() falls back to "development" when NODE_ENV is unset (branch 4)', () => {
      logger.structured('log', 'no-env structured', {}, 'Ctx');
      expect(writeSpy).toHaveBeenCalled();
      expect(lastEntry().env).toBe('development');
    });
  });
});
