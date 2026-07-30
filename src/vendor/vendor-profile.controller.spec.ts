import {
  BadRequestException,
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { bearer } from '../../test/auth-helper';
import type { AuthUser } from '../auth/auth-user';
import { JwtGuard } from '../auth/guards/jwt.guard';
import type { VendorTrackingSettingsRecord } from '../prisma/prisma.service';
import { CreateVendorProfileDto } from './dto/create-vendor-profile.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { UpdateVendorProfileDto } from './dto/update-vendor-profile.dto';
import { VendorProfileController } from './vendor-profile.controller';
import { VendorProfileService } from './vendor-profile.service';

const VENDOR_A = 'GVENDORPRIMARYADDRESS12345678901234567890123456789012';
const VENDOR_B = 'GVENDORSECONDARYADDRESS12345678901234567890123456789';

const AUTH_A = bearer(VENDOR_A);
const AUTH_B = bearer(VENDOR_B);

const mockProfileA = {
  id: 'profile-1',
  address: VENDOR_A,
  businessName: 'Vendor A Business',
  email: 'vendora@example.com',
  phone: '+1-555-0199',
  description: 'Description A',
  createdAt: new Date('2026-07-29T10:00:00.000Z'),
  updatedAt: new Date('2026-07-29T10:00:00.000Z'),
};

const mockProfileB = {
  id: 'profile-2',
  address: VENDOR_B,
  businessName: 'Vendor B Business',
  email: 'vendorb@example.com',
  phone: '+1-555-0299',
  description: 'Description B',
  createdAt: new Date('2026-07-29T10:00:00.000Z'),
  updatedAt: new Date('2026-07-29T10:00:00.000Z'),
};

const mockPreferencesA: VendorTrackingSettingsRecord = {
  id: 'track-1',
  vendorAddress: VENDOR_A,
  notifyOnDelivery: true,
  notifyOnDelay: true,
  notifyOnException: true,
  notificationChannels: ['EMAIL'],
  webhookUrl: 'https://vendora.example.com/webhook',
  webhookSecret: 'secret-a',
  enableTracking: true,
  delayThresholdHours: 24,
  deliveryConfirmation: true,
  trackingHistoryRetentionDays: 30,
  createdAt: new Date('2026-07-29T10:00:00.000Z'),
  updatedAt: new Date('2026-07-29T10:00:00.000Z'),
};

const mockPreferencesB: VendorTrackingSettingsRecord = {
  id: 'track-2',
  vendorAddress: VENDOR_B,
  notifyOnDelivery: false,
  notifyOnDelay: false,
  notifyOnException: false,
  notificationChannels: ['SMS'],
  webhookUrl: 'https://vendorb.example.com/webhook',
  webhookSecret: 'secret-b',
  enableTracking: false,
  delayThresholdHours: 48,
  deliveryConfirmation: false,
  trackingHistoryRetentionDays: 60,
  createdAt: new Date('2026-07-29T10:00:00.000Z'),
  updatedAt: new Date('2026-07-29T10:00:00.000Z'),
};

describe('VendorProfileController', () => {
  let controller: VendorProfileController;
  let service: jest.Mocked<VendorProfileService>;
  let app: INestApplication;

  const userA: AuthUser = { address: VENDOR_A };
  const userB: AuthUser = { address: VENDOR_B };

  beforeEach(async () => {
    service = {
      createProfile: jest.fn(),
      getProfile: jest.fn(),
      upsertProfile: jest.fn(),
      updateProfile: jest.fn(),
      getNotificationPreferences: jest.fn(),
      updateNotificationPreferences: jest.fn(),
    } as unknown as jest.Mocked<VendorProfileService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VendorProfileController],
      providers: [
        JwtGuard,
        { provide: VendorProfileService, useValue: service },
      ],
    }).compile();

    controller = module.get(VendorProfileController);

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Direct Unit Tests for Controller Handlers
  // ───────────────────────────────────────────────────────────────────────────

  describe('Direct Unit Tests (Handler Invocations)', () => {
    describe('create()', () => {
      it('invokes createProfile with user.address and DTO', async () => {
        const dto: CreateVendorProfileDto = {
          businessName: 'Acme Goods',
          email: 'acme@example.com',
        };
        service.createProfile.mockResolvedValue(mockProfileA);

        const result = await controller.create(dto, userA);

        expect(service.createProfile).toHaveBeenCalledWith(VENDOR_A, dto);
        expect(result).toEqual(mockProfileA);
      });

      it('propagates ConflictException when profile already exists', async () => {
        const dto: CreateVendorProfileDto = { businessName: 'Acme Goods' };
        service.createProfile.mockRejectedValue(
          new ConflictException('Vendor profile already exists'),
        );

        await expect(controller.create(dto, userA)).rejects.toThrow(
          ConflictException,
        );
      });
    });

    describe('get()', () => {
      it('invokes getProfile with user.address', async () => {
        service.getProfile.mockResolvedValue(mockProfileA);

        const result = await controller.get(userA);

        expect(service.getProfile).toHaveBeenCalledWith(VENDOR_A);
        expect(result).toEqual(mockProfileA);
      });

      it('invokes getProfile with user.address for userB', async () => {
        service.getProfile.mockResolvedValue(mockProfileB);

        const result = await controller.get(userB);

        expect(service.getProfile).toHaveBeenCalledWith(VENDOR_B);
        expect(result).toEqual(mockProfileB);
      });

      it('propagates NotFoundException when profile is not found', async () => {
        service.getProfile.mockRejectedValue(
          new NotFoundException('Vendor profile not found'),
        );

        await expect(controller.get(userA)).rejects.toThrow(NotFoundException);
      });
    });

    describe('upsert()', () => {
      it('invokes upsertProfile with user.address and DTO', async () => {
        const dto: CreateVendorProfileDto = { businessName: 'Acme Goods' };
        service.upsertProfile.mockResolvedValue(mockProfileA);

        const result = await controller.upsert(dto, userA);

        expect(service.upsertProfile).toHaveBeenCalledWith(VENDOR_A, dto);
        expect(result).toEqual(mockProfileA);
      });
    });

    describe('update()', () => {
      it('invokes updateProfile with user.address and DTO', async () => {
        const dto: UpdateVendorProfileDto = { businessName: 'Acme Updated' };
        service.updateProfile.mockResolvedValue(mockProfileA);

        const result = await controller.update(dto, userA);

        expect(service.updateProfile).toHaveBeenCalledWith(VENDOR_A, dto);
        expect(result).toEqual(mockProfileA);
      });

      it('propagates BadRequestException when no update fields are provided', async () => {
        const dto: UpdateVendorProfileDto = {};
        service.updateProfile.mockRejectedValue(
          new BadRequestException('No update fields provided'),
        );

        await expect(controller.update(dto, userA)).rejects.toThrow(
          BadRequestException,
        );
      });

      it('propagates NotFoundException when profile does not exist', async () => {
        const dto: UpdateVendorProfileDto = { businessName: 'Ghost' };
        service.updateProfile.mockRejectedValue(
          new NotFoundException('Vendor profile not found'),
        );

        await expect(controller.update(dto, userA)).rejects.toThrow(
          NotFoundException,
        );
      });
    });

    describe('getNotifications()', () => {
      it('invokes getNotificationPreferences with user.address', async () => {
        service.getNotificationPreferences.mockResolvedValue(mockPreferencesA);

        const result = await controller.getNotifications(userA);

        expect(service.getNotificationPreferences).toHaveBeenCalledWith(
          VENDOR_A,
        );
        expect(result).toEqual(mockPreferencesA);
      });
    });

    describe('updateNotifications()', () => {
      it('invokes updateNotificationPreferences with user.address and DTO', async () => {
        const dto: UpdateNotificationPreferencesDto = {
          notifyOnDelivery: false,
        };
        const updatedResult = { trackingSettings: mockPreferencesA };
        service.updateNotificationPreferences.mockResolvedValue(updatedResult);

        const result = await controller.updateNotifications(dto, userA);

        expect(service.updateNotificationPreferences).toHaveBeenCalledWith(
          VENDOR_A,
          dto,
        );
        expect(result).toEqual(updatedResult);
      });

      it('propagates NotFoundException when vendor profile does not exist', async () => {
        const dto: UpdateNotificationPreferencesDto = { notifyOnDelay: false };
        service.updateNotificationPreferences.mockRejectedValue(
          new NotFoundException('Vendor profile not found'),
        );

        await expect(
          controller.updateNotifications(dto, userA),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. HTTP Endpoints, Authentication, Authorization & Ownership Enforcement
  // ───────────────────────────────────────────────────────────────────────────

  describe('HTTP Route Endpoints & Security Integration', () => {
    describe('Authentication Guards (@UseGuards(JwtGuard))', () => {
      it('rejects requests missing an Authorization header with 401', async () => {
        await request(app.getHttpServer()).get('/vendor/profile').expect(401);

        await request(app.getHttpServer())
          .post('/vendor/profile')
          .send({ businessName: 'Test' })
          .expect(401);

        await request(app.getHttpServer())
          .put('/vendor/profile')
          .send({ businessName: 'Test' })
          .expect(401);

        await request(app.getHttpServer())
          .patch('/vendor/profile')
          .send({ businessName: 'Test' })
          .expect(401);

        await request(app.getHttpServer())
          .get('/vendor/profile/notifications')
          .expect(401);

        await request(app.getHttpServer())
          .patch('/vendor/profile/notifications')
          .send({ notifyOnDelivery: true })
          .expect(401);
      });

      it('rejects raw Stellar addresses passed as Bearer tokens with 401', async () => {
        await request(app.getHttpServer())
          .get('/vendor/profile')
          .set('Authorization', `Bearer ${VENDOR_A}`)
          .expect(401);
      });

      it('rejects invalid or corrupted JWT tokens with 401', async () => {
        await request(app.getHttpServer())
          .get('/vendor/profile')
          .set('Authorization', 'Bearer header.payload.badsignature')
          .expect(401);
      });
    });

    describe('Authorization & Cross-Vendor Isolation', () => {
      it('prevents Vendor B from reading Vendor A profile (uses authenticated address)', async () => {
        service.getProfile.mockImplementation(async (addr: string) => {
          if (addr === VENDOR_A) return mockProfileA;
          throw new NotFoundException('Vendor profile not found');
        });

        // Vendor B calls GET /vendor/profile
        const res = await request(app.getHttpServer())
          .get('/vendor/profile')
          .set('Authorization', AUTH_B)
          .expect(404);

        expect(service.getProfile).toHaveBeenCalledWith(VENDOR_B);
        expect(service.getProfile).not.toHaveBeenCalledWith(VENDOR_A);
        expect(res.body.message).toBe('Vendor profile not found');
      });

      it('prevents Vendor B from updating Vendor A profile', async () => {
        service.updateProfile.mockImplementation(async (addr: string) => {
          if (addr === VENDOR_B) {
            return mockProfileB;
          }
          throw new NotFoundException('Vendor profile not found');
        });

        await request(app.getHttpServer())
          .patch('/vendor/profile')
          .set('Authorization', AUTH_B)
          .send({ businessName: 'Vendor B Edit' })
          .expect(200);

        expect(service.updateProfile).toHaveBeenCalledWith(
          VENDOR_B,
          expect.anything(),
        );
        expect(service.updateProfile).not.toHaveBeenCalledWith(
          VENDOR_A,
          expect.anything(),
        );
      });

      it('enforces ownership on notification preference routes', async () => {
        service.getNotificationPreferences.mockImplementation(
          async (addr: string) => {
            if (addr === VENDOR_B) return mockPreferencesB;
            return mockPreferencesA;
          },
        );

        const res = await request(app.getHttpServer())
          .get('/vendor/profile/notifications')
          .set('Authorization', AUTH_B)
          .expect(200);

        expect(service.getNotificationPreferences).toHaveBeenCalledWith(
          VENDOR_B,
        );
        expect(res.body).toEqual(
          expect.objectContaining({
            id: 'track-2',
            vendorAddress: VENDOR_B,
            notifyOnDelivery: false,
            notificationChannels: ['SMS'],
          }),
        );
      });
    });

    describe('Address Ownership Enforcement (Ignores Client-Supplied Body/Param Address)', () => {
      it('ignores any client-supplied address in POST /vendor/profile body', async () => {
        service.createProfile.mockResolvedValue(mockProfileA);

        await request(app.getHttpServer())
          .post('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({
            businessName: 'Spoofing Inc',
            address: VENDOR_B,
            vendorAddress: VENDOR_B,
          })
          .expect(201);

        expect(service.createProfile).toHaveBeenCalledWith(
          VENDOR_A,
          expect.objectContaining({ businessName: 'Spoofing Inc' }),
        );
        expect(service.createProfile).not.toHaveBeenCalledWith(
          VENDOR_B,
          expect.anything(),
        );
      });

      it('ignores any client-supplied address in PUT /vendor/profile body', async () => {
        service.upsertProfile.mockResolvedValue(mockProfileA);

        await request(app.getHttpServer())
          .put('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({
            businessName: 'Spoofing Upsert',
            address: VENDOR_B,
          })
          .expect(200);

        expect(service.upsertProfile).toHaveBeenCalledWith(
          VENDOR_A,
          expect.objectContaining({ businessName: 'Spoofing Upsert' }),
        );
      });

      it('ignores any client-supplied address in PATCH /vendor/profile body', async () => {
        service.updateProfile.mockResolvedValue(mockProfileA);

        await request(app.getHttpServer())
          .patch('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({
            businessName: 'Spoofing Update',
            address: VENDOR_B,
          })
          .expect(200);

        expect(service.updateProfile).toHaveBeenCalledWith(
          VENDOR_A,
          expect.objectContaining({ businessName: 'Spoofing Update' }),
        );
      });

      it('ignores any client-supplied address in PATCH /vendor/profile/notifications body', async () => {
        service.updateNotificationPreferences.mockResolvedValue({
          trackingSettings: mockPreferencesA,
        });

        await request(app.getHttpServer())
          .patch('/vendor/profile/notifications')
          .set('Authorization', AUTH_A)
          .send({
            notifyOnDelivery: false,
            address: VENDOR_B,
          })
          .expect(200);

        expect(service.updateNotificationPreferences).toHaveBeenCalledWith(
          VENDOR_A,
          expect.objectContaining({ notifyOnDelivery: false }),
        );
      });
    });

    describe('Exposed Routes Success & Failure HTTP Responses', () => {
      it('POST /vendor/profile returns 201 on success', async () => {
        service.createProfile.mockResolvedValue(mockProfileA);

        const res = await request(app.getHttpServer())
          .post('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({ businessName: 'New Vendor' })
          .expect(201);

        expect(res.body.address).toBe(VENDOR_A);
      });

      it('POST /vendor/profile returns 409 on conflict', async () => {
        service.createProfile.mockRejectedValue(
          new ConflictException('Vendor profile already exists'),
        );

        await request(app.getHttpServer())
          .post('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({ businessName: 'Existing Vendor' })
          .expect(409);
      });

      it('GET /vendor/profile returns 200 on success', async () => {
        service.getProfile.mockResolvedValue(mockProfileA);

        const res = await request(app.getHttpServer())
          .get('/vendor/profile')
          .set('Authorization', AUTH_A)
          .expect(200);

        expect(res.body.address).toBe(VENDOR_A);
      });

      it('GET /vendor/profile returns 404 when profile not found', async () => {
        service.getProfile.mockRejectedValue(
          new NotFoundException('Vendor profile not found'),
        );

        await request(app.getHttpServer())
          .get('/vendor/profile')
          .set('Authorization', AUTH_A)
          .expect(404);
      });

      it('PUT /vendor/profile returns 200 on success', async () => {
        service.upsertProfile.mockResolvedValue(mockProfileA);

        const res = await request(app.getHttpServer())
          .put('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({ businessName: 'Upsert Vendor' })
          .expect(200);

        expect(res.body.businessName).toBe('Vendor A Business');
      });

      it('PATCH /vendor/profile returns 200 on success', async () => {
        service.updateProfile.mockResolvedValue(mockProfileA);

        const res = await request(app.getHttpServer())
          .patch('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({ businessName: 'Patched Vendor' })
          .expect(200);

        expect(res.body.businessName).toBe('Vendor A Business');
      });

      it('PATCH /vendor/profile returns 404 when profile not found', async () => {
        service.updateProfile.mockRejectedValue(
          new NotFoundException('Vendor profile not found'),
        );

        await request(app.getHttpServer())
          .patch('/vendor/profile')
          .set('Authorization', AUTH_A)
          .send({ businessName: 'Patched Vendor' })
          .expect(404);
      });

      it('GET /vendor/profile/notifications returns 200 on success', async () => {
        service.getNotificationPreferences.mockResolvedValue(mockPreferencesA);

        const res = await request(app.getHttpServer())
          .get('/vendor/profile/notifications')
          .set('Authorization', AUTH_A)
          .expect(200);

        expect(res.body.notifyOnDelivery).toBe(true);
      });

      it('PATCH /vendor/profile/notifications returns 200 on success', async () => {
        service.updateNotificationPreferences.mockResolvedValue({
          trackingSettings: mockPreferencesA,
        });

        const res = await request(app.getHttpServer())
          .patch('/vendor/profile/notifications')
          .set('Authorization', AUTH_A)
          .send({ notifyOnDelivery: false })
          .expect(200);

        expect(res.body.trackingSettings.notifyOnDelivery).toBe(true);
      });

      it('PATCH /vendor/profile/notifications returns 404 when profile not found', async () => {
        service.updateNotificationPreferences.mockRejectedValue(
          new NotFoundException('Vendor profile not found'),
        );

        await request(app.getHttpServer())
          .patch('/vendor/profile/notifications')
          .set('Authorization', AUTH_A)
          .send({ notifyOnDelivery: false })
          .expect(404);
      });
    });
  });
});
