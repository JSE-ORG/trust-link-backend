import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';
import { AUTH_CHALLENGE_THROTTLE } from '../../common/security/throttle.config';
import {
  CHALLENGE_TIMEOUT_SECONDS,
  MAX_CHALLENGE_TRANSACTION_LENGTH,
  MAX_REFRESH_TOKEN_LENGTH,
} from './sep10.constants';
import { Sep10Service } from './sep10.service';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

/**
 * Query string for the legacy `GET /auth` challenge route. `account` was
 * previously read without validation, so a missing or malformed key reached
 * the Stellar SDK and surfaced as a 500 (issue #935).
 *
 * The other SEP-10 challenge parameters are accepted so that standard wallets
 * that send them are not rejected by `forbidNonWhitelisted`; they are not
 * used when building the challenge.
 */
export class ChallengeQueryDto {
  @ApiProperty({
    description:
      'Stellar public key (G...) of the wallet requesting a challenge.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @IsStellarAddress()
  account!: string;

  @ApiPropertyOptional({ description: 'SEP-10 memo (not used).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  memo?: string;

  @ApiPropertyOptional({ description: 'SEP-10 home domain (not used).' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  home_domain?: string;

  @ApiPropertyOptional({ description: 'SEP-10 client domain (not used).' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  client_domain?: string;
}

export class ChallengeRequestDto {
  @ApiProperty({
    description:
      'Stellar public key (G...) of the wallet requesting a challenge.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @IsStellarAddress()
  publicKey!: string;
}

export class VerifyChallengeDto {
  @ApiProperty({
    description:
      'Base64-encoded signed SEP-10 challenge XDR returned by the challenge endpoint.',
    example: 'AAAAAgAAAAA...',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_CHALLENGE_TRANSACTION_LENGTH)
  transaction!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'Refresh token issued during the last successful authentication.',
    example: 'f0e1d2c3b4a5968778695a4b3c2d1e0f0e1d2c3b4a5968778695a4b3c2d1e0f',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_REFRESH_TOKEN_LENGTH)
  refreshToken!: string;
}

export class ChallengeResponseDto {
  @ApiProperty({
    description: 'Base64-encoded unsigned SEP-10 challenge transaction XDR.',
    example: 'AAAAAgAAAAA...',
  })
  transaction!: string;
}

export class ChallengeWithNetworkResponseDto {
  @ApiProperty({
    description: 'Base64-encoded unsigned SEP-10 challenge transaction XDR.',
    example: 'AAAAAgAAAAA...',
  })
  transaction!: string;

  @ApiProperty({
    description:
      'Stellar network passphrase the challenge was constructed for.',
    example: 'Test SDF Network ; September 2015',
  })
  network_passphrase!: string;
}

export class AuthTokenResponseDto {
  @ApiProperty({
    description:
      'JWT access token used in Authorization Bearer header for authenticated requests.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJHQUlHWkhIV0szUkVaUVBMUVg1RE5GUllEVVBGR0c2Vlk0UFNXU0w1M04yT1kzWjNIM0NFNVRNSyIsImlhdCI6MTc0MDUwMDAwMCwiZXhwIjoxNzQwNTAwOTAwfQ.fake_signature_placeholder',
  })
  token!: string;

  @ApiProperty({
    description:
      'Opaque refresh token used to obtain a new access token via POST /auth/refresh before expiration. Lifetime is 30 days (2,592,000 seconds) by default.',
    example: 'f0e1d2c3b4a5968778695a4b3c2d1e0f0e1d2c3b4a5968778695a4b3c2d1e0f',
  })
  refreshToken!: string;
}

@ApiTags('Auth')
@Throttle({ default: AUTH_CHALLENGE_THROTTLE })
// Class-level, like the throttle: every /auth route can return these.
@ApiResponse({
  status: 429,
  description: 'Too many requests.',
  type: ErrorResponseDto,
})
@ApiResponse({
  status: 500,
  description: 'Internal server error.',
  type: ErrorResponseDto,
})
@Controller('auth')
export class Sep10Controller {
  constructor(private readonly sep10Service: Sep10Service) {}

  @ApiOperation({ summary: 'Issue SEP-10 challenge (legacy query-param form)' })
  @ApiResponse({
    status: 200,
    description: 'Challenge transaction XDR returned.',
    type: ChallengeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid Stellar public key.',
  })
  @Get()
  async challengeGet(@Query() query: ChallengeQueryDto) {
    return {
      transaction: await this.sep10Service.buildChallenge(
        query.account,
        CHALLENGE_TIMEOUT_SECONDS,
      ),
    };
  }

  @ApiOperation({
    summary: 'Issue SEP-10 challenge transaction for wallet signing',
  })
  @ApiResponse({
    status: 200,
    description: 'Challenge XDR and network passphrase returned.',
    type: ChallengeWithNetworkResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid public key.' })
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  async challengePost(@Body() dto: ChallengeRequestDto) {
    return {
      transaction: await this.sep10Service.buildChallenge(
        dto.publicKey,
        CHALLENGE_TIMEOUT_SECONDS,
      ),
      network_passphrase: this.sep10Service.getNetworkPassphrase(),
    };
  }

  @ApiOperation({ summary: 'Verify signed SEP-10 challenge and issue JWT' })
  @ApiResponse({
    status: 200,
    description: 'JWT access token and refresh token issued.',
    type: AuthTokenResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired challenge transaction.',
  })
  @ApiResponse({ status: 401, description: 'Signature verification failed.' })
  @Post()
  async verify(@Body() dto: VerifyChallengeDto) {
    return await this.sep10Service.verifyAndIssueToken(dto.transaction);
  }

  @ApiOperation({ summary: 'Rotate refresh token and issue new JWT pair' })
  @ApiResponse({
    status: 200,
    description: 'New JWT access and refresh tokens issued.',
    type: AuthTokenResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid or expired.',
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return await this.sep10Service.rotateRefreshToken(dto.refreshToken);
  }
}
