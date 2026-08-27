import { S3PresignService } from './s3-presign.service';

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
    const service = new S3PresignService();

    const signedUrl = service.presign('https://uploads.example.com/evidence.jpg');

    expect(signedUrl).toMatch(
      /^https:\/\/uploads\.example\.com\/evidence\.jpg\?X-Expires=1787749200000&X-Signature=[a-f0-9]{16}$/,
    );
  });

  it.each(presignAllCases)('presigns $description', ({
    urls,
    expectedPrefixes,
  }) => {
    const service = new S3PresignService();

    const signedUrls = service.presignAll(urls);

    expect(signedUrls).toHaveLength(expectedPrefixes.length);
    signedUrls.forEach((signedUrl, index) => {
      expect(signedUrl).toMatch(
        new RegExp(
          `^${expectedPrefixes[index].replace('?', '\\?')}&X-Signature=[a-f0-9]{16}$`,
        ),
      );
    });
  });
});
