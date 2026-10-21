import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateVendorAccountDetailsDto } from './update-vendor-account-details.dto';

function toDto(plain: Record<string, unknown>): UpdateVendorAccountDetailsDto {
  return plainToInstance(UpdateVendorAccountDetailsDto, plain);
}

async function errors(plain: Record<string, unknown>): Promise<string[]> {
  const dto = toDto(plain);
  const result = await validate(dto);
  return result.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('UpdateVendorAccountDetailsDto validation (#940)', () => {
  it('accepts an empty payload (all fields optional)', async () => {
    expect(await errors({})).toHaveLength(0);
  });

  describe('country fields (@IsISO31661Alpha2)', () => {
    it('accepts valid ISO 3166-1 alpha-2 country codes', async () => {
      expect(
        await errors({ billingCountry: 'US', shippingCountry: 'GB' }),
      ).toHaveLength(0);
      expect(
        await errors({ billingCountry: 'NG', shippingCountry: 'CA' }),
      ).toHaveLength(0);
    });

    it('rejects invalid country codes', async () => {
      const billingErrors = await errors({ billingCountry: 'USA' });
      expect(billingErrors.length).toBeGreaterThan(0);
      expect(billingErrors.some((e) => /country/i.test(e) || /ISO31661Alpha2/i.test(e))).toBe(true);

      const shippingErrors = await errors({ shippingCountry: 'INVALID' });
      expect(shippingErrors.length).toBeGreaterThan(0);
      expect(shippingErrors.some((e) => /country/i.test(e) || /ISO31661Alpha2/i.test(e))).toBe(true);
    });
  });

  describe('websiteUrl (@IsUrl)', () => {
    it('accepts valid URL', async () => {
      expect(
        await errors({ websiteUrl: 'https://example.com/vendor' }),
      ).toHaveLength(0);
    });

    it('rejects invalid URL', async () => {
      const errs = await errors({ websiteUrl: 'not-a-valid-url' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /url/i.test(e))).toBe(true);
    });
  });

  describe('socialMediaLinks (@IsUrl and @ArrayMaxSize(20))', () => {
    it('accepts valid URLs within limit', async () => {
      expect(
        await errors({
          socialMediaLinks: [
            'https://twitter.com/acme',
            'https://instagram.com/acme',
          ],
        }),
      ).toHaveLength(0);
    });

    it('rejects invalid URLs in array', async () => {
      const errs = await errors({
        socialMediaLinks: ['https://twitter.com/acme', 'not-a-url'],
      });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /url/i.test(e))).toBe(true);
    });

    it('rejects more than 20 social media links', async () => {
      const links = Array.from(
        { length: 21 },
        (_, i) => `https://link${i}.com`,
      );
      const errs = await errors({ socialMediaLinks: links });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /max/i.test(e) || /20/i.test(e))).toBe(true);
    });
  });

  describe('paymentMethods (@ArrayMaxSize(20))', () => {
    it('accepts up to 20 payment methods', async () => {
      const methods = Array.from({ length: 20 }, (_, i) => `METHOD_${i}`);
      expect(await errors({ paymentMethods: methods })).toHaveLength(0);
    });

    it('rejects more than 20 payment methods', async () => {
      const methods = Array.from({ length: 21 }, (_, i) => `METHOD_${i}`);
      const errs = await errors({ paymentMethods: methods });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /max/i.test(e) || /20/i.test(e))).toBe(true);
    });
  });

  describe('timezone (IANA check @IsTimeZone)', () => {
    it('accepts valid IANA timezones', async () => {
      expect(await errors({ timezone: 'UTC' })).toHaveLength(0);
      expect(await errors({ timezone: 'America/New_York' })).toHaveLength(0);
      expect(await errors({ timezone: 'Europe/London' })).toHaveLength(0);
      expect(await errors({ timezone: 'Asia/Tokyo' })).toHaveLength(0);
    });

    it('rejects invalid timezones', async () => {
      const errs = await errors({ timezone: 'Mars/Phobos' });
      expect(errs.length).toBeGreaterThan(0);
      expect(errs.some((e) => /timezone/i.test(e) || /time zone/i.test(e))).toBe(true);
    });
  });
});
