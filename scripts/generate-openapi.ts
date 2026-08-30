import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/openapi';

const outputPath = resolve(process.cwd(), 'openapi.json');

async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const document = createOpenApiDocument(app);
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

generateOpenApi().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`OpenAPI generation failed: ${message}\n`);
  process.exitCode = 1;
});
