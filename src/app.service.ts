import { Injectable } from '@nestjs/common';
import { getAppName, getAppVersion } from './common/version';
import { ServiceInfoResponseDto } from './common/dto/service-info-response.dto';

/** Where `setupOpenApiUi` mounts Swagger UI outside production. */
export const API_DOCS_PATH = '/api/docs';

@Injectable()
export class AppService {
  /**
   * Describes the service for `GET /`: package name, version, and the docs
   * path when Swagger UI is mounted (it is not in production). Touches no
   * dependency; use the `/health` endpoints for readiness.
   */
  getInfo(isProduction: boolean): ServiceInfoResponseDto {
    return {
      name: getAppName(),
      version: getAppVersion(),
      docsPath: isProduction ? null : API_DOCS_PATH,
    };
  }
}
