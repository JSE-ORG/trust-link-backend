import { IsNotEmpty, IsString } from 'class-validator';

export class RotateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  key: string;
}
