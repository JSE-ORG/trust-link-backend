describe('Sentry instrumentation bootstrap', () => {
  const previousDsn = process.env.SENTRY_DSN;
  const previousEnvironment = process.env.NODE_ENV;
  const previousGitSha = process.env.GIT_SHA;

  afterEach(() => {
    jest.resetModules();
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousGitSha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = previousGitSha;
  });

  it('initializes Sentry only when a DSN is configured and reuses OpenTelemetry', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    process.env.NODE_ENV = 'production';
    process.env.GIT_SHA = 'test-sha';
    const init = jest.fn();
    jest.doMock('@sentry/nestjs', () => ({ init }));

    jest.isolateModules(() => {
      jest.requireActual('./sentry.instrument');
    });

    expect(init).toHaveBeenCalledWith({
      dsn: process.env.SENTRY_DSN,
      release: 'test-sha',
      environment: 'production',
      tracesSampleRate: 0.2,
      skipOpenTelemetrySetup: true,
    });
  });

  it('does not initialize Sentry when no DSN is configured', () => {
    delete process.env.SENTRY_DSN;
    const init = jest.fn();
    jest.doMock('@sentry/nestjs', () => ({ init }));

    jest.isolateModules(() => {
      jest.requireActual('./sentry.instrument');
    });

    expect(init).not.toHaveBeenCalled();
  });
});
