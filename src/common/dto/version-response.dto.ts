import { ApiProperty } from '@nestjs/swagger';

export class VersionResponseDto {
  @ApiProperty({
    description: 'Application version from package.json.',
    example: '1.4.2',
  })
  version!: string;

  @ApiProperty({
    description: 'Package name.',
    example: '@truestlink/trustlink-backend',
  })
  name!: string;

  @ApiProperty({
    description: 'Current NODE_ENV value.',
    example: 'production',
  })
  environment!: string;
}
