import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Returns the default application greeting for the root endpoint. */
  getHello(): string {
    return 'Hello World!';
  }
}
