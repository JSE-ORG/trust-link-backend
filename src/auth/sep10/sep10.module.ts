import { Module } from '@nestjs/common';
import { Sep10Controller } from './sep10.controller';
import { Sep10Service } from './sep10.service';

@Module({
  controllers: [Sep10Controller],
  providers: [Sep10Service],
  exports: [Sep10Service],
})
export class Sep10Module {}
