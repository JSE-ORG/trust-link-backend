import { S3PresignService } from './s3-presign.service';
import type { ConfigService } from '../../config/config.service';

const SECRET_A = 'stable-secret-a';
const SECRET_B = 'stable-secret-b';

function makeService(secret: string): S3PresignService {
  const config = {
    get: (key: string) => (key === 'PRESIGN_SECRET' ? secret : undefined),
  } as unknown as ConfigService;
  return new S3PresignService(config);
}

describe('S3PresignService', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');
  const presignAllCases: Array<{
    description: string;
    urls: string[];
    expectedPrefixes: string[];
  }> = [
    { description: 'an empty list', urls: [], expectedPrefixes: [] },
    {
      description: 'multiple evidence URLs in their original order',
      urls: [
        'https://uploads.example.com/photo.jpg',
        'https://uploads.example.com/receipt.pdf',
      ],
      expectedPrefixes: [
        'https://uploads.example.com/photo.jpg?X-Expires=1787749200000',
        'https://uploads.example.com/receipt.pdf?X-Expires=1787749200000',
      ],
    },
  ];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a one-hour signed URL with a compact HMAC signature', () => {
    const service = makeService(SECRET_A);

    const signedUrl = service.presign(
      'https://uploads.example.com/evidence.jpg',
    );

    expect(signedUrl).toMatch(
      /^https:\/\/uploads\.example\.com\/evidence\.jpg\?X-Expires=1787749200000&X-Signature=[a-f0-9]{16}$/,
    );
  });

  it.each(presignAllCases)(
    'presigns $description',
    ({ urls, expectedPrefixes }) => {
      const service = makeService(SECRET_A);

      const signedUrls = service.presignAll(urls);

      expect(signedUrls).toHaveLength(expectedPrefixes.length);
      signedUrls.forEach((signedUrl, index) => {
        expect(signedUrl).toMatch(
          new RegExp(
            `^${expectedPrefixes[index].replace('?', '\\?')}&X-Signature=[a-f0-9]{16}$`,
          ),
        );
      });
    },
  );

  it('throws a clear error when PRESIGN_SECRET is not configured', () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;

    expect(() => new S3PresignService(config)).toThrow(/PRESIGN_SECRET/);
  });

  it('returns identical URLs for two instances sharing the same configured secret', () => {
    const serviceA = makeService(SECRET_A);
    const serviceB = makeService(SECRET_A);

    const url = 'https://uploads.example.com/evidence.jpg';
    expect(serviceA.presign(url)).toBe(serviceB.presign(url));
  });

  it('returns a different signature for a different configured secret', () => {
    const serviceA = makeService(SECRET_A);
    const serviceB = makeService(SECRET_B);

    const url = 'https://uploads.example.com/evidence.jpg';
    expect(serviceA.presign(url)).not.toBe(serviceB.presign(url));
  });

  it('binds the expiry timestamp into the signed material so it cannot be altered', () => {
    const service = makeService(SECRET_A);

    const url = 'https://uploads.example.com/evidence.jpg';
    const first = service.presign(url);
    const firstExpiry = first.match(/X-Expires=(\d+)/)?.[1];
    expect(firstExpiry).toBeDefined();

    // Sign the same URL at a later time: the expiry differs, so the signature
    // must differ too. If the expiry were not part of the HMAC input, altering
    // a URL's X-Expires would not change its signature.
    const later = new Date(now.getTime() + 60_000);
    jest.setSystemTime(later);
    const second = service.presign(url);

    expect(second).not.toBe(first);
    expect(second).toContain(`X-Expires=${Date.now() + 3600_000}`);
    expect(second).toMatch(/X-Signature=[a-f0-9]{16}$/);
  });
});
