describe('Sentry instrumentation bootstrap', () => {
  const previousDsn = process.env.SENTRY_DSN;
  const previousEnvironment = process.env.NODE_ENV;
  const previousGitSha = process.env.GIT_SHA;
  const previousSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE;

  afterEach(() => {
    jest.resetModules();
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousGitSha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = previousGitSha;
    if (previousSampleRate === undefined)
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    else process.env.SENTRY_TRACES_SAMPLE_RATE = previousSampleRate;
  });

  function loadWith(init: jest.Mock): void {
    jest.doMock('@sentry/nestjs', () => ({ init }));
    jest.isolateModules(() => {
      jest.requireActual('./sentry.instrument');
    });
  }

  it('initializes Sentry only when a DSN is configured and reuses OpenTelemetry', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    process.env.GIT_SHA = 'test-sha';
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    const init = jest.fn();

    loadWith(init);

    expect(init).toHaveBeenCalledWith({
      dsn: process.env.SENTRY_DSN,
      release: 'test-sha',
      environment: 'production',
      tracesSampleRate: 0.2,
      skipOpenTelemetrySetup: true,
    });
  });

  it('defaults to a full sample rate outside production', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'development';
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    const init = jest.fn();

    loadWith(init);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'development',
        tracesSampleRate: 1.0,
      }),
    );
  });

  it('honours SENTRY_TRACES_SAMPLE_RATE in production', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.05';
    const init = jest.fn();

    loadWith(init);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.05 }),
    );
  });

  it('honours SENTRY_TRACES_SAMPLE_RATE outside production', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'development';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5';
    const init = jest.fn();

    loadWith(init);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.5 }),
    );
  });

  it.each([
    ['0', 0],
    ['1', 1],
  ])('accepts the boundary value %s', (raw, expected) => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_TRACES_SAMPLE_RATE = raw;
    const init = jest.fn();

    loadWith(init);

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: expected }),
    );
  });

  it('falls back to the default for an empty or invalid override', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';

    process.env.SENTRY_TRACES_SAMPLE_RATE = '';
    let init = jest.fn();
    loadWith(init);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.2 }),
    );

    jest.resetModules();
    process.env.SENTRY_TRACES_SAMPLE_RATE = '1.5';
    init = jest.fn();
    loadWith(init);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.2 }),
    );

    jest.resetModules();
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'not-a-number';
    init = jest.fn();
    loadWith(init);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.2 }),
    );
  });

  it('does not initialize Sentry when no DSN is configured', () => {
    delete process.env.SENTRY_DSN;
    const init = jest.fn();

    loadWith(init);

    expect(init).not.toHaveBeenCalled();
  });
});
