import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Sep10Service } from './sep10.service';
import { Sep10Controller } from './sep10.controller';

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

  it('passes the legacy account query to challenge creation unchanged', async () => {
    sep10Service.buildChallenge.mockResolvedValue('challenge-xdr');

    await expect(controller.challengeGet('GACCOUNT')).resolves.toEqual({
      transaction: 'challenge-xdr',
    });
    expect(sep10Service.buildChallenge).toHaveBeenCalledWith('GACCOUNT');
  });

  it('passes the challenge public key and fixed expiry to the service', async () => {
    sep10Service.buildChallenge.mockResolvedValue('challenge-xdr');
    sep10Service.getNetworkPassphrase.mockReturnValue('testnet');

    await expect(
      controller.challengePost({ publicKey: 'GACCOUNT' }),
    ).resolves.toEqual({
      transaction: 'challenge-xdr',
      network_passphrase: 'testnet',
    });
    expect(sep10Service.buildChallenge).toHaveBeenCalledWith('GACCOUNT', 900);
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
});
