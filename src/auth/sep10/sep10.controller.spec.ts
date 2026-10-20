import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Sep10Service } from './sep10.service';
import {
  ChallengeQueryDto,
  RefreshTokenDto,
  Sep10Controller,
  VerifyChallengeDto,
} from './sep10.controller';
import {
  CHALLENGE_TIMEOUT_SECONDS,
  MAX_CHALLENGE_TRANSACTION_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
} from './sep10.constants';

const VALID_ACCOUNT =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('Sep10Controller', () => {
  const sep10Service: jest.Mocked<
    Pick<
      Sep10Service,
      | 'buildChallenge'
      | 'getNetworkPassphrase'
      | 'verifyAndIssueToken'
      | 'rotateRefreshToken'
    >
  > = {
    buildChallenge: jest.fn(),
    getNetworkPassphrase: jest.fn(),
    verifyAndIssueToken: jest.fn(),
    rotateRefreshToken: jest.fn(),
  };
  const controller = new Sep10Controller(
    sep10Service as unknown as Sep10Service,
  );

  afterEach(() => jest.clearAllMocks());

  it('keeps challenge and token issuance routes public for wallet authentication', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, Sep10Controller) ?? []).toEqual(
      [],
    );
  });

  it('passes the legacy account query and shared expiry to challenge creation', async () => {
    sep10Service.buildChallenge.mockResolvedValue('challenge-xdr');

    await expect(
      controller.challengeGet({ account: 'GACCOUNT' }),
    ).resolves.toEqual({
      transaction: 'challenge-xdr',
    });
    expect(sep10Service.buildChallenge).toHaveBeenCalledWith(
      'GACCOUNT',
      CHALLENGE_TIMEOUT_SECONDS,
    );
  });

  it('passes the challenge public key and shared expiry to the service', async () => {
    sep10Service.buildChallenge.mockResolvedValue('challenge-xdr');
    sep10Service.getNetworkPassphrase.mockReturnValue('testnet');

    await expect(
      controller.challengePost({ publicKey: 'GACCOUNT' }),
    ).resolves.toEqual({
      transaction: 'challenge-xdr',
      network_passphrase: 'testnet',
    });
    expect(sep10Service.buildChallenge).toHaveBeenCalledWith(
      'GACCOUNT',
      CHALLENGE_TIMEOUT_SECONDS,
    );
    expect(sep10Service.getNetworkPassphrase).toHaveBeenCalledWith();
  });

  it('passes the signed transaction through to verification unchanged', async () => {
    const expected = { token: 'access', refreshToken: 'refresh' };
    sep10Service.verifyAndIssueToken.mockResolvedValue(expected);

    await expect(
      controller.verify({ transaction: 'signed-xdr' }),
    ).resolves.toBe(expected);
    expect(sep10Service.verifyAndIssueToken).toHaveBeenCalledWith('signed-xdr');
  });

  it('passes the refresh token through to rotation unchanged', async () => {
    const expected = { token: 'new-access', refreshToken: 'new-refresh' };
    sep10Service.rotateRefreshToken.mockResolvedValue(expected);

    await expect(
      controller.refresh({ refreshToken: 'old-refresh' }),
    ).resolves.toBe(expected);
    expect(sep10Service.rotateRefreshToken).toHaveBeenCalledWith('old-refresh');
  });

  describe('input validation (issue #935)', () => {
    async function errorsFor<T extends object>(
      cls: new () => T,
      body: Record<string, unknown>,
    ) {
      const errors = await validate(plainToInstance(cls, body));
      return errors.map((error) => error.property);
    }

    it('accepts a valid account query', async () => {
      await expect(
        errorsFor(ChallengeQueryDto, { account: VALID_ACCOUNT }),
      ).resolves.toEqual([]);
    });

    it('accepts the optional SEP-10 challenge parameters', async () => {
      await expect(
        errorsFor(ChallengeQueryDto, {
          account: VALID_ACCOUNT,
          home_domain: 'trustlink.example',
          client_domain: 'wallet.example',
        }),
      ).resolves.toEqual([]);
    });

    it('rejects a missing account', async () => {
      await expect(errorsFor(ChallengeQueryDto, {})).resolves.toEqual([
        'account',
      ]);
    });

    it('rejects an account that is not a Stellar public key', async () => {
      await expect(
        errorsFor(ChallengeQueryDto, { account: 'bogus' }),
      ).resolves.toEqual(['account']);
    });

    it('bounds the signed challenge transaction length', async () => {
      await expect(
        errorsFor(VerifyChallengeDto, {
          transaction: 'A'.repeat(MAX_CHALLENGE_TRANSACTION_LENGTH),
        }),
      ).resolves.toEqual([]);
      await expect(
        errorsFor(VerifyChallengeDto, {
          transaction: 'A'.repeat(MAX_CHALLENGE_TRANSACTION_LENGTH + 1),
        }),
      ).resolves.toEqual(['transaction']);
    });

    it('bounds the refresh token length', async () => {
      await expect(
        errorsFor(RefreshTokenDto, {
          refreshToken: 'a'.repeat(MAX_REFRESH_TOKEN_LENGTH),
        }),
      ).resolves.toEqual([]);
      await expect(
        errorsFor(RefreshTokenDto, {
          refreshToken: 'a'.repeat(MAX_REFRESH_TOKEN_LENGTH + 1),
        }),
      ).resolves.toEqual(['refreshToken']);
    });
  });
});
