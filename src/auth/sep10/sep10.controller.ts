import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Sep10Service } from './sep10.service';

class VerifyChallengeDto {
  @IsString()
  @MinLength(1)
  transaction!: string;
}

@Controller('auth')
export class Sep10Controller {
  constructor(private readonly sep10Service: Sep10Service) {}

  /** GET /auth?account=<G...> — issue a SEP-10 challenge */
  @Get()
  challenge(@Query('account') account: string) {
    return { transaction: this.sep10Service.buildChallenge(account) };
  }

  /** POST /auth { transaction: "<signed-base64-xdr>" } — verify and issue JWT */
  @Post()
  verify(@Body() dto: VerifyChallengeDto) {
    const token = this.sep10Service.verifyAndIssueToken(dto.transaction);
    return { token };
  }
}
