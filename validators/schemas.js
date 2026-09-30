const { z } = require('zod');
const { TASK_PRIORITIES, TASK_STATUSES } = require('../config/constants');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const optId = z.preprocess((v) => (v === '' ? null : v), objectId.nullable().optional());
const optDate = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.date().nullable().optional());
const optStr = (max) => z.preprocess((v) => (v == null ? '' : v), z.string().trim().max(max).optional());
const password = z.string().min(8, 'Password must be at least 8 characters').regex(/[A-Za-z]/, 'Password needs a letter').regex(/\d/, 'Password needs a number');
const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const website = z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().url('Website must start with http:// or https://').optional());

const orgFields = {
  name: z.string().trim().min(2, 'Organization name is required').max(120),
  type: optStr(60), phone: optStr(30), address: optStr(200), website,
};

const register = z.object({
  accountType: z.enum(['PERSONAL', 'BUSINESS']),
  name: z.string().trim().min(2, 'Name is required').max(80),
  email, password,
  inviteToken: z.string().optional(),
  organization: z.object(orgFields).optional(),
}).refine((d) => d.inviteToken || d.accountType !== 'BUSINESS' || d.organization, { message: 'Organization details are required', path: ['organization'] });

const login = z.object({ email, password: z.string().min(1, 'Password is required') });
const profile = z.object({ name: z.string().trim().min(2).max(80).optional(), phone: optStr(30) });
const changePassword = z.object({ currentPassword: z.string().min(1), newPassword: password });

const task = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: optStr(5000), note: optStr(2000),
  category: optId, assignedTo: optId, assignedTeam: optId,
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  date: optDate, dueDate: optDate, dueHasTime: z.boolean().optional(),
});
const taskUpdate = task.partial();

const category = z.object({ name: z.string().trim().min(1, 'Name is required').max(40), color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour').optional() });
const team = z.object({ name: z.string().trim().min(2, 'Team name is required').max(80), description: optStr(500), leader: optId });
const org = z.object(orgFields).partial();
const invite = z.object({ email, team: optId });
const memberTeams = z.object({ teamIds: z.array(objectId) });
const payment = z.object({
  amount: z.coerce.number().positive('Enter the amount you paid'),
  paymentDate: z.coerce.date({ invalid_type_error: 'Enter the payment date' }),
  reference: optStr(120), description: optStr(500),
});
const reject = z.object({ reason: optStr(300) });
const paymentInfo = z.object({
  bankName: z.string().trim().min(2, 'Bank name is required').max(80),
  accountName: z.string().trim().min(2, 'Account name is required').max(120),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  instructions: optStr(500),
});
const status = z.object({ isActive: z.boolean() });

module.exports = { register, login, profile, changePassword, task, taskUpdate, category, team, org, invite, memberTeams, payment, reject, paymentInfo, status };
