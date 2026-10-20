import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Returns the fixed `"Hello World!"` string served by `GET /`.
   *
   * A liveness sentinel only — it takes no input, touches no dependency, and
   * always returns the same constant, so a 200 here means the HTTP layer and
   * routing are up but says nothing about the database or Stellar
   * connectivity (use the `/health` endpoints for that).
   */
  getHello(): string {
    return 'Hello World!';
  }
}
