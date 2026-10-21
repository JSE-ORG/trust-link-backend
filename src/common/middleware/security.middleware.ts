import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Cache-Control is not a helmet concern, so we keep it here.
    // All other security headers are managed by helmet in main.ts.
    if (req.headers.authorization) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }

    next();
  }
}
