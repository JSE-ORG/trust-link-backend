import { Injectable } from '@nestjs/common';

/** Shape returned by GET /. */
export class ServiceInfoDto {
  /** Service name. */
  name: string;
  /** Semver version string from package.json. */
  version: string;
  /** Path to the interactive OpenAPI docs, when enabled. */
  docsPath: string | null;
}

@Injectable()
export class AppService {
  /**
   * Returns the service identity block served by `GET /`.
   *
   * Replaces the NestJS starter's 'Hello World!' (issue #1144).
   * Includes the service name, current version, and the OpenAPI docs path
   * so a visitor or health-check script immediately knows what they hit.
   *
   * The docs path is `/api` when `SWAGGER_ENABLED` is truthy (the default in
   * non-production environments) and `null` otherwise, matching the
   * conditional mount in `main.ts`.
   */
  getInfo(): ServiceInfoDto {
    const swaggerEnabled =
      process.env.SWAGGER_ENABLED !== 'false' &&
      process.env.NODE_ENV !== 'production';

    return {
      name: 'trustlink-backend',
      version: process.env.npm_package_version ?? '0.0.0',
      docsPath: swaggerEnabled ? '/api' : null,
    };
  }
}
