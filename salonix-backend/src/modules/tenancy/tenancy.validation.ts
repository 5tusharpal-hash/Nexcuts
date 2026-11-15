import { z } from 'zod';

const businessHoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean(),
  opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

export const createSalonApplicationSchema = z.object({
  organizationName: z.string().trim().min(2).max(255).optional(),
  legalName: z.string().trim().max(255).optional(),
  businessType: z.enum(['SOLO', 'TEAM']),
  businessHours: z.array(businessHoursSchema).length(7),
  services: z.array(z.object({
    name: z.string().trim().min(2).max(255),
    description: z.string().trim().max(2000).optional(),
    estimatedDurationMinutes: z.number().int().min(5).max(1440),
    basePrice: z.number().min(0).max(9999999999),
    targetAudience: z.enum(['WOMEN', 'MEN', 'KIDS', 'UNISEX']).default('UNISEX'),
  })).max(100).default([]),
  firstSalon: z.object({
    branchCode: z.string().trim().min(1).max(50).default('MAIN'),
    name: z.string().trim().min(2).max(255),
    addressLine1: z.string().trim().min(1).max(255),
    addressLine2: z.string().trim().max(255).optional(),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().max(24).optional(),
    countryCode: z.string().length(2).default('IN'),
    timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
  }),
}).superRefine((value, context) => {
  const days = value.businessHours.map(({ dayOfWeek }) => dayOfWeek);
  if (new Set(days).size !== 7) {
    context.addIssue({
      code: 'custom',
      path: ['businessHours'],
      message: 'Business hours must include each day exactly once',
    });
  }
  for (const [index, hours] of value.businessHours.entries()) {
    const hasTimes = hours.opensAt !== undefined && hours.closesAt !== undefined;
    if (hours.isClosed ? hours.opensAt !== undefined || hours.closesAt !== undefined : !hasTimes) {
      context.addIssue({
        code: 'custom',
        path: ['businessHours', index],
        message: 'Open days need opening and closing times, closed days must not include times',
      });
    } else if (hasTimes && hours.closesAt! <= hours.opensAt!) {
      context.addIssue({
        code: 'custom',
        path: ['businessHours', index, 'closesAt'],
        message: 'Closing time must be later than opening time',
      });
    }
  }
});

export const reviewSalonApplicationSchema = z.object({
  status: z.enum(['CHANGES_REQUESTED', 'APPROVED', 'REJECTED']),
  reviewNotes: z.string().trim().max(4000).optional(),
}).superRefine(({ status, reviewNotes }, context) => {
  if (status !== 'APPROVED' && !reviewNotes) {
    context.addIssue({
      code: 'custom',
      path: ['reviewNotes'],
      message: 'A review note is required for changes requested or rejection',
    });
  }
});
