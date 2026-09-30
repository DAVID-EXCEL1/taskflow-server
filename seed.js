require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { ROLES, DEFAULT_CATEGORIES, PLANS } = require('./config/constants');
const M = (n) => require(`./models/${n}`);
const [User, Organization, Team, Task, Category, Subscription, Payment, Setting, Notification, ActivityLog, Invitation] =
  ['User', 'Organization', 'Team', 'Task', 'Category', 'Subscription', 'Payment', 'Setting', 'Notification', 'ActivityLog', 'Invitation'].map(M);
const { addMonths } = require('./utils/helpers');

const DEMO_PASSWORD = 'Password123!';
const day = (n) => new Date(Date.now() + n * 86400000);

async function reset() {
  await Promise.all([User, Organization, Team, Task, Category, Subscription, Payment, Setting, Notification, ActivityLog, Invitation].map((m) => m.deleteMany({})));
  console.log('Database cleared.');
}

async function activeSub(subject, plan, startOffsetDays) {
  const startDate = day(startOffsetDays);
  const p = await Payment.create({ ...subject, plan, amount: PLANS[plan].price, paymentDate: startDate, status: 'Approved', submittedBy: subject.user || subject.organizationOwner, reviewedAt: startDate, reference: 'SEED-' + Math.floor(Math.random() * 1e6) });
  const s = await Subscription.create({ ...subject, plan, amount: PLANS[plan].price, status: 'Active', startDate, endDate: addMonths(startDate, 1), payment: p._id });
  p.subscription = s._id; await p.save();
  return s;
}

async function main() {
  await connectDB();
  if (process.argv.includes('--reset')) await reset();
  else if (await User.exists({ role: ROLES.SUPER_ADMIN })) { console.log('Already seeded. Use "npm run seed:reset" to wipe and reseed.'); return process.exit(0); }

  const admin = await User.create({ name: process.env.SEED_ADMIN_NAME || 'Platform Owner', email: (process.env.SEED_ADMIN_EMAIL || 'admin@taskdesk.local').toLowerCase(), password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!', role: ROLES.SUPER_ADMIN });
  await Setting.create({ key: 'payment', value: { bankName: 'Your Bank Name', accountName: 'Your Account Name', accountNumber: '0123456789', instructions: 'Use your registered email as the transfer narration.' }, updatedBy: admin._id });

  // --- Individuals ---
  const david = await User.create({ name: 'David Okafor', email: 'david@demo.com', password: DEMO_PASSWORD, role: ROLES.INDIVIDUAL });
  const cats = await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, user: david._id })));
  await activeSub({ user: david._id }, 'INDIVIDUAL', -10);
  const titles = [['Prepare quarterly budget', 'Finance', 'High', 'In Progress', 3], ['Renew car insurance', 'Finance', 'Urgent', 'Pending', -2], ['Gym session', 'Health', 'Low', 'Completed', -1], ['Submit project proposal', 'Work', 'High', 'Pending', 5], ['Book dentist appointment', 'Health', 'Medium', 'Pending', 9], ['Plan weekend trip', 'Personal', 'Low', 'Pending', 12]];
  await Task.insertMany(titles.map(([title, cat, priority, status, due]) => ({ title, priority, status, dueDate: day(due), date: day(-3), category: cats.find((c) => c.name === cat)._id, createdBy: david._id, owner: david._id, completedAt: status === 'Completed' ? new Date() : undefined, note: '' })));

  const grace = await User.create({ name: 'Grace Eze', email: 'expired@demo.com', password: DEMO_PASSWORD, role: ROLES.INDIVIDUAL });
  const gc = await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, user: grace._id })));
  await activeSub({ user: grace._id }, 'INDIVIDUAL', -45); // expired ~15 days ago
  await Task.insertMany([{ title: 'Old task (read-only demo)', category: gc[0]._id, createdBy: grace._id, owner: grace._id, dueDate: day(-20) }, { title: 'Another old task', status: 'Completed', category: gc[1]._id, createdBy: grace._id, owner: grace._id }]);

  const ken = await User.create({ name: 'Ken Bello', email: 'pending@demo.com', password: DEMO_PASSWORD, role: ROLES.INDIVIDUAL });
  await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, user: ken._id })));
  const kp = await Payment.create({ user: ken._id, plan: 'INDIVIDUAL', amount: 2000, paymentDate: new Date(), reference: 'TRF-88213', description: 'Monthly subscription', status: 'Pending', submittedBy: ken._id });
  kp.subscription = (await Subscription.create({ user: ken._id, plan: 'INDIVIDUAL', amount: 2000, status: 'Pending', payment: kp._id }))._id; await kp.save();

  // --- Business: ABC Technologies ---
  const owner = await User.create({ name: 'Amara Nwosu', email: 'owner@demo.com', password: DEMO_PASSWORD, role: ROLES.ORGANIZATION_OWNER });
  const org = await Organization.create({ name: 'ABC Technologies', type: 'Technology company', phone: '+2348012345678', address: 'Wuse 2, Abuja', website: 'https://abc-tech.example.com', owner: owner._id });
  owner.organization = org._id; await owner.save();
  const oc = await Category.insertMany([...DEFAULT_CATEGORIES, { name: 'Client work', color: '#2563EB' }].map((c) => ({ ...c, organization: org._id })));
  const [sw, mk, ops] = await Team.insertMany(['Software Development', 'Marketing', 'Operations'].map((name) => ({ name, organization: org._id, createdBy: owner._id, description: `${name} team` })));
  const mkMember = (name, email, team) => User.create({ name, email, password: DEMO_PASSWORD, role: ROLES.ORGANIZATION_MEMBER, organization: org._id, teams: [team._id] });
  const dev = await mkMember('Peter Adeyemi', 'member@demo.com', sw);
  const mary = await mkMember('Mary Johnson', 'mary@demo.com', mk);
  const john = await mkMember('John Musa', 'john@demo.com', ops);
  sw.leader = dev._id; await sw.save();
  await activeSub({ organization: org._id, organizationOwner: owner._id }, 'BUSINESS', -5);
  const t = (title, cat, priority, status, due, extra) => ({ title, priority, status, dueDate: day(due), date: day(-2), category: oc.find((c) => c.name === cat)._id, createdBy: owner._id, organization: org._id, ...extra });
  await Task.insertMany([
    t('Ship v2 dashboard', 'Work', 'Urgent', 'In Progress', 4, { assignedTeam: sw._id }),
    t('Fix login timeout bug', 'Work', 'High', 'Pending', -1, { assignedTo: dev._id, assignedTeam: sw._id }),
    t('Launch Q4 campaign', 'Client work', 'High', 'Pending', 10, { assignedTeam: mk._id, assignedTo: mary._id }),
    t('Design social media calendar', 'Work', 'Medium', 'Completed', -4, { assignedTo: mary._id, completedAt: new Date() }),
    t('Renew office lease', 'Finance', 'Medium', 'Pending', 20, { assignedTeam: ops._id }),
    t('Vendor payments review', 'Finance', 'High', 'In Progress', 2, { assignedTo: john._id }),
    t('Onboard new hires', 'Work', 'Low', 'Pending', 14, {}),
  ]);
  await Invitation.create({ organization: org._id, email: 'newhire@demo.com', team: sw._id, token: 'demo-invite-token-123', invitedBy: owner._id, expiresAt: day(7) });

  // Pending business-renewal-style request to show admin workflow
  const bp = await Payment.create({ organization: org._id, plan: 'BUSINESS', amount: 5000, paymentDate: new Date(), reference: 'TRF-99120', status: 'Pending', submittedBy: owner._id });
  bp.subscription = (await Subscription.create({ organization: org._id, plan: 'BUSINESS', amount: 5000, status: 'Pending', payment: bp._id }))._id; await bp.save();

  console.log(`\nSeed complete.\n\nSuper Admin : ${admin.email} / ${process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!'}\nDemo password for all demo users: ${DEMO_PASSWORD}\n  Individual (active)   david@demo.com\n  Individual (expired)  expired@demo.com\n  Individual (pending)  pending@demo.com\n  Org owner             owner@demo.com\n  Org member            member@demo.com\n  Invite link           /invite/demo-invite-token-123\n`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
