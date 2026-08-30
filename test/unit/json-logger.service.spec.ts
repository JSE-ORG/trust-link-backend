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
});
