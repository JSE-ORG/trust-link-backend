import { ApiProperty } from '@nestjs/swagger';

/** Body of `GET /`. */
export class ServiceInfoResponseDto {
  @ApiProperty({
    description: 'Package name.',
    example: 'trustlink-backend',
  })
  name!: string;

  @ApiProperty({
    description: 'Application version from package.json.',
    example: '1.4.2',
  })
  version!: string;

  @ApiProperty({
    description:
      'Path of the interactive API docs, or null when they are disabled (production).',
    example: '/api/docs',
    nullable: true,
    type: String,
  })
  docsPath!: string | null;
}
