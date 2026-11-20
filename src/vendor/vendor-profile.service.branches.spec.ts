/**
 * Tests for VendorProfileService branches (issue #1127).
 *
 * Covers: createProfile placeholder → upsert, getProfile placeholder description → null,
 * updateProfile empty dto → BadRequestException.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { VendorProfileService } from './vendor-profile.service';
import { VendorProfileRepository } from './vendor-profile.repository';
import { createTracingMock } from '../../test/unit/tracing-mock';
import { VendorProfileRecord } from '../prisma/prisma.service';
import { VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION } from './vendor-profile.constants';

function makeProfile(
  overrides: Partial<VendorProfileRecord> = {},
): VendorProfileRecord {
  return {
    address: 'VENDOR',
    businessName: 'Biz',
    description: 'A real description',
    email: null,
    phone: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(
  repo: Partial<jest.Mocked<VendorProfileRepository>>,
): VendorProfileService {
  const fullRepo = {
    findByAddress: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    ...repo,
  } as unknown as jest.Mocked<VendorProfileRepository>;
  return new VendorProfileService(fullRepo, createTracingMock().service);
}

describe('VendorProfileService.createProfile', () => {
  it('upserts when existing profile is a placeholder', async () => {
    const placeholder = makeProfile({
      businessName: 'VENDOR',
      description: VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION,
    });
    const updated = makeProfile({ description: 'Real biz' });
    const repo = {
      findByAddress: jest.fn().mockResolvedValue(placeholder),
      upsert: jest.fn().mockResolvedValue(updated),
    };
    const svc = makeService(repo);
    const result = await svc.createProfile('VENDOR', {
      businessName: 'Real biz',
    });
    expect(repo.upsert).toHaveBeenCalled();
    expect(result.description).toBe('Real biz');
  });

  it('throws ConflictException when a real profile already exists', async () => {
    const existing = makeProfile({ description: 'Existing biz' });
    const repo = { findByAddress: jest.fn().mockResolvedValue(existing) };
    const svc = makeService(repo);
    await expect(
      svc.createProfile('VENDOR', { businessName: 'New' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('VendorProfileService.getProfile', () => {
  it('returns description as null when stored value is the placeholder', async () => {
    const profile = makeProfile({
      description: VENDOR_PROFILE_PLACEHOLDER_DESCRIPTION,
    });
    const repo = { findByAddress: jest.fn().mockResolvedValue(profile) };
    const svc = makeService(repo);
    const result = await svc.getProfile('VENDOR');
    expect(result.description).toBeNull();
  });

  it('throws NotFoundException when profile does not exist', async () => {
    const repo = { findByAddress: jest.fn().mockResolvedValue(null) };
    const svc = makeService(repo);
    await expect(svc.getProfile('VENDOR')).rejects.toThrow(NotFoundException);
  });
});

describe('VendorProfileService.updateProfile', () => {
  it('throws BadRequestException when all dto fields are undefined', async () => {
    const svc = makeService({});
    await expect(svc.updateProfile('VENDOR', {})).rejects.toThrow(
      BadRequestException,
    );
  });
});
