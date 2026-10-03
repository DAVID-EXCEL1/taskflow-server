const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { protect, authorize, requireTwoFactor } = require('../middleware/auth');
const { requirePermission } = require('../config/permissions');
const { requireActiveSubscription: writable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const v = require('../validators/schemas');
const { ROLES } = require('../config/constants');

const auth = require('../controllers/authController');
const tasks = require('../controllers/taskController');
const cats = require('../controllers/categoryController');
const orgs = require('../controllers/organizationController');
const admin = require('../controllers/adminController');
const billing = require('../controllers/billingController');
const misc = require('../controllers/miscController');
const dash = require('../controllers/dashboardController');
const pushCtl = require('../controllers/pushController');
const security = require('../controllers/securityController');
const aiCtl = require('../controllers/aiController');
const planCtl = require('../controllers/planController');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many attempts. Try again in a few minutes.' } });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many requests. Try again in a few minutes.' } });
const aiUserLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?._id || 'anon'), message: { success: false, message: 'Slow down a little and try again in a minute.' } });
const { SUPER_ADMIN, ORGANIZATION_OWNER, ORGANIZATION_MEMBER, INDIVIDUAL } = ROLES;
const orgUsers = authorize(ORGANIZATION_OWNER, ORGANIZATION_MEMBER);
const ownerOnly = authorize(ORGANIZATION_OWNER);
const adminOnly = authorize(SUPER_ADMIN);

// ---- Public ----
router.get('/health', (req, res) => res.json({ ok: true }));
router.get('/plans', billing.plans);
router.post('/auth/register', authLimiter, validate(v.register), auth.register);
router.post('/auth/login', authLimiter, validate(v.login), auth.login);
router.post('/auth/login/2fa', authLimiter, validate(v.login2fa), security.login2fa);
router.post('/auth/forgot-password', forgotLimiter, validate(v.forgotPassword), security.forgotPassword);
router.post('/auth/reset-password', authLimiter, validate(v.resetPassword), security.resetPassword);
router.get('/invitations/token/:token', orgs.inviteByToken);
router.get('/cron/run', pushCtl.cron);   // secured by CRON_SECRET, for an external scheduler
router.post('/cron/run', pushCtl.cron);

// ---- Everything below requires login ----
router.use(protect);
router.get('/auth/me', auth.me);
router.put('/auth/profile', validate(v.profile), auth.updateProfile);          // allowed while read-only
router.put('/auth/password', authLimiter, validate(v.changePassword), auth.changePassword);
router.post('/auth/2fa/setup', authLimiter, security.setup2fa);
router.post('/auth/2fa/enable', authLimiter, validate(v.code2fa), security.enable2fa);
router.post('/auth/2fa/disable', authLimiter, validate(v.disable2fa), security.disable2fa);

router.get('/dashboard', dash.get);
router.get('/ai/me', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), planCtl.me);
router.put('/ai/me', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), validate(v.aiOptIn), planCtl.setOptIn);
router.post('/ai/draft-tasks', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), aiUserLimiter, validate(v.aiDraft), planCtl.draftTasks);
router.post('/ai/plan-day', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), aiUserLimiter, planCtl.planDay);
router.get('/push/config', pushCtl.config);
router.post('/push/subscribe', validate(v.pushSubscription), pushCtl.subscribe);
router.post('/push/unsubscribe', validate(v.pushEndpoint), pushCtl.unsubscribe);
router.post('/push/test', pushCtl.test);
router.get('/notifications', misc.listNotifications);
router.post('/notifications/read-all', misc.markAllRead);
router.patch('/notifications/:id/read', misc.markRead);
router.get('/activity', misc.listActivity);

// Tasks (write routes are blocked for expired / unpaid accounts)
router.get('/tasks', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), tasks.list);
router.get('/tasks/:id', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), tasks.get);
router.post('/tasks', requirePermission('tasks:create'), writable, validate(v.task), tasks.create);
router.put('/tasks/:id', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), writable, validate(v.taskUpdate), tasks.update);
router.patch('/tasks/:id', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), writable, validate(v.taskUpdate), tasks.update);
router.delete('/tasks/:id', authorize(INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), writable, tasks.remove);

// Categories
router.get('/categories', cats.list);
router.post('/categories', requirePermission('categories:manage'), writable, validate(v.category), cats.create);
router.put('/categories/:id', requirePermission('categories:manage'), writable, validate(v.category.partial()), cats.update);
router.delete('/categories/:id', requirePermission('categories:manage'), writable, cats.remove);

// Organization, members, teams, invitations
router.get('/organizations', adminOnly, orgs.adminList);
router.get('/organizations/me', orgUsers, orgs.getMine);
router.put('/organizations/me', ownerOnly, writable, validate(v.org), orgs.updateMine);
router.get('/organizations/:id', adminOnly, orgs.adminGet);
router.patch('/organizations/:id/status', adminOnly, requireTwoFactor, validate(v.status), orgs.adminSetStatus);

router.get('/members', orgUsers, orgs.listMembers);
router.put('/members/:id/teams', ownerOnly, writable, validate(v.memberTeams), orgs.setMemberTeams);
router.delete('/members/:id', ownerOnly, writable, orgs.removeMember);

router.get('/teams', orgUsers, orgs.listTeams);
router.post('/teams', ownerOnly, writable, validate(v.team), orgs.createTeam);
router.put('/teams/:id', ownerOnly, writable, validate(v.team.partial()), orgs.updateTeam);
router.delete('/teams/:id', ownerOnly, writable, orgs.deleteTeam);

router.get('/invitations', ownerOnly, orgs.listInvitations);
router.post('/invitations', ownerOnly, writable, validate(v.invite), orgs.createInvitation);
router.delete('/invitations/:id', ownerOnly, writable, orgs.cancelInvitation);
router.post('/invitations/token/:token/accept', orgs.acceptInvite);
router.post('/invitations/token/:token/reject', orgs.rejectInvite);

// Users (Super Admin)
router.get('/users', adminOnly, admin.listUsers);
router.get('/users/:id', adminOnly, admin.getUser);
router.patch('/users/:id/status', adminOnly, requireTwoFactor, validate(v.status), admin.setUserStatus);

// Subscriptions & payments
router.get('/subscriptions', authorize(SUPER_ADMIN, INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), billing.listSubscriptions);
router.get('/subscriptions/status', billing.myStatus);
router.post('/subscriptions/run-checks', adminOnly, billing.runChecks);
router.get('/payments', authorize(SUPER_ADMIN, INDIVIDUAL, ORGANIZATION_OWNER, ORGANIZATION_MEMBER), billing.listPayments);
router.post('/payments', requirePermission('payments:submit'), upload.single('proof'), validate(v.payment), billing.submitPayment);
router.get('/payments/:id/proof', authorize(SUPER_ADMIN, INDIVIDUAL, ORGANIZATION_OWNER), billing.proof);
router.post('/payments/:id/approve', adminOnly, requireTwoFactor, billing.approve);
router.post('/payments/:id/reject', adminOnly, requireTwoFactor, validate(v.reject), billing.reject);
router.get('/settings/payment', billing.getPaymentInfo);
router.get('/settings/ai', adminOnly, aiCtl.status);
router.put('/settings/ai', adminOnly, validate(v.aiSwitch), aiCtl.setEnabled);
router.post('/settings/ai/test', adminOnly, authLimiter, aiCtl.test);
router.put('/settings/payment', adminOnly, requireTwoFactor, validate(v.paymentInfo), billing.setPaymentInfo);

module.exports = router;
