import { z } from 'zod/v4';
import { DateTime } from './calendar.js';
export const id = z.coerce.number().int().positive();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => DateTime.fromISO(d).isValid, 'Invalid calendar date');
export const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const zone = z.string().refine(v => DateTime.now().setZone(v).isValid, 'Invalid IANA timezone');
export const text = z.string().max(5000);
export const profile = z.object({
  name: z.string().min(2).max(120),
  email: z.email().max(200),
  employee_code: z.string().min(1).max(50),
  role_id: id,
  access: z.enum(['admin', 'employee']).default('employee'),
  joining_date: date,
  timezone: zone.default('Asia/Karachi'),
  workdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  deadline: clock,
  notifications: z.boolean(),
  email_notifications: z.boolean(),
  category_ids: z.array(id).max(100)
});
export const activity = z.object({
  category_id: id,
  assignment_id: id.nullable().default(null),
  title: z.string().min(1).max(160),
  description: text.default(''),
  actual: z.number().finite().min(0).max(1e12),
  unit: z.string().min(1).max(50),
  outcome: text.default(''),
  status: z.enum(['in_progress', 'completed', 'blocked']),
  minutes: z.number().min(0).max(1440),
  evidence: z.union([z.literal(''), z.url().refine(v => /^https?:\/\//i.test(v), 'Use an HTTP(S) link')]).default(''),
  links: z.array(z.url().refine(v => /^https?:\/\//i.test(v), 'Use an HTTP(S) link')).max(20).default([]),
  notes: text.default('')
});
export const reportInput = z.object({
  date,
  version: z.number().int().min(0),
  activities: z.array(activity).max(100),
  achievements: text,
  blockers: text,
  missed_reason: text,
  lessons: text,
  suggestions: text,
  next_plan: text,
  assistance: text,
  submit: z.boolean()
});
export const assignmentInput = z.object({
  user_id: id,
  kpi_id: id,
  target: z.number().positive().max(1e12),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  start_date: date,
  end_date: date.nullable().default(null),
  weight: z.number().positive().max(100),
  minimum_quality: z.number().min(0).max(100).nullable().default(null)
}).refine(v => !v.end_date || v.end_date >= v.start_date, 'End date precedes start');
export const scoreInput = z.object({
  user_id: id.nullable().default(null),
  role_id: id.nullable().default(null),
  effective_date: date,
  weights: z.object({
    achievement: z.number().min(0).max(100),
    quality: z.number().min(0).max(100),
    impact: z.number().min(0).max(100),
    consistency: z.number().min(0).max(100),
    learning: z.number().min(0).max(100)
  }),
  cap: z.number().min(100).max(200),
  bands: z.array(z.object({
    min: z.number().min(0).max(100),
    label: z.string().min(1).max(80)
  })).min(1).max(10)
}).refine(v => !(v.user_id && v.role_id), 'Choose one scope').refine(v => Math.abs(Object.values(v.weights).reduce((a, b) => a + b, 0) - 100) < 0.001, 'Weights must total 100%').refine(v => v.bands.at(-1)?.min === 0 && v.bands.every((b, i) => i === 0 || b.min < v.bands[i - 1].min), 'Rating bands must descend and end at zero');
