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
} from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { SkipThrottle } from '@nestjs/throttler';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';
import { Sep10Service } from './sep10.service';

class ChallengeRequestDto {
  @ApiProperty({
    description:
      'Stellar public key (G...) of the wallet requesting a challenge.',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @IsStellarAddress()
  publicKey!: string;
}

class VerifyChallengeDto {
  @ApiProperty({
    description:
      'Base64-encoded signed SEP-10 challenge XDR returned by the challenge endpoint.',
    example: 'AAAAAQAAAA...',
  })
  @IsString()
  @MinLength(1)
  transaction!: string;
}

class RefreshTokenDto {
  @ApiProperty({
    description:
      'Refresh token issued during the last successful authentication.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class Sep10Controller {
  constructor(private readonly sep10Service: Sep10Service) {}

  @ApiOperation({ summary: 'Issue SEP-10 challenge (legacy query-param form)' })
  @ApiResponse({
    status: 200,
    description: 'Challenge transaction XDR returned.',
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar public key.' })
  @Get()
  async challengeGet(@Query('account') account: string) {
    return { transaction: await this.sep10Service.buildChallenge(account) };
  }

  @ApiOperation({
    summary: 'Issue SEP-10 challenge transaction for wallet signing',
  })
  @ApiResponse({
    status: 200,
    description: 'Challenge XDR and network passphrase returned.',
  })
  @ApiResponse({ status: 400, description: 'Invalid public key.' })
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ public: true })
  async challengePost(@Body() dto: ChallengeRequestDto) {
    return {
      transaction: await this.sep10Service.buildChallenge(dto.publicKey, 900),
      network_passphrase: this.sep10Service.getNetworkPassphrase(),
    };
  }

  @ApiOperation({ summary: 'Verify signed SEP-10 challenge and issue JWT' })
  @ApiResponse({
    status: 200,
    description: 'JWT access token and refresh token issued.',
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
