import { ApiProperty } from '@nestjs/swagger';

export class VersionResponseDto {
  @ApiProperty({
    description: 'Application version from package.json.',
    example: '1.4.2',
  })
  version!: string;

  @ApiProperty({
    description: 'Package name.',
    example: 'trustlink-backend',
  })
  name!: string;

  @ApiProperty({
    description: 'Current NODE_ENV value.',
    example: 'production',
  })
  environment!: string;

  @ApiProperty({
    description:
      'Git commit SHA the deployed build came from (GIT_SHA). Omitted when GIT_SHA is not set.',
    example: '3f9c2d1a7b6e5f4d3c2b1a0998877665544332211',
    required: false,
  })
  commit?: string;
}
