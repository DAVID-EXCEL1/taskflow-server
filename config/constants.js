const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  INDIVIDUAL: 'INDIVIDUAL',
  ORGANIZATION_OWNER: 'ORGANIZATION_OWNER',
  ORGANIZATION_MEMBER: 'ORGANIZATION_MEMBER',
});

// Single source of truth for plans. Add new plans here later.
const PLANS = Object.freeze({
  INDIVIDUAL: {
    key: 'INDIVIDUAL',
    name: 'Personal',
    price: 2000,
    currency: 'NGN',
    durationMonths: 1,
    features: ['Unlimited personal tasks', 'Custom categories', 'Spreadsheet-style task grid', 'Task history and statistics', 'Excel and CSV export'],
  },
  BUSINESS: {
    key: 'BUSINESS',
    name: 'Business',
    price: 5000,
    currency: 'NGN',
    durationMonths: 1,
    features: ['Everything in Personal', 'Teams inside your organization', 'Invite unlimited members', 'Assign tasks to people or teams', 'Organization dashboard and activity log'],
  },
});

const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const TASK_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
const SUB_STATUS = Object.freeze({ PENDING: 'Pending', ACTIVE: 'Active', EXPIRED: 'Expired', REJECTED: 'Rejected' });
const PAYMENT_STATUS = Object.freeze({ PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' });
const INVITE_STATUS = Object.freeze({ PENDING: 'Pending', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired' });
const DEFAULT_CATEGORIES = [
  { name: 'Work', color: '#0F6B4F' },
  { name: 'Personal', color: '#6C5CE7' },
  { name: 'Finance', color: '#E8A317' },
  { name: 'Health', color: '#D64545' },
];
const REMINDER_DAYS = [7, 3, 1];
// Bump when the Terms/Privacy change materially (keep in sync with client/src/config/legal.js).
const TERMS_VERSION = '2026-10-03';
// Renewal opens this many days before expiry (set to 0 to allow renewal only after expiry).
const RENEWAL_WINDOW_DAYS = 7;

module.exports = { ROLES, PLANS, TASK_PRIORITIES, TASK_STATUSES, SUB_STATUS, PAYMENT_STATUS, INVITE_STATUS, DEFAULT_CATEGORIES, REMINDER_DAYS, RENEWAL_WINDOW_DAYS, TERMS_VERSION };
