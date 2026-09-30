const { ROLES } = require('./constants');
const AppError = require('../utils/AppError');

// Permission map: add new permissions/roles here without touching controllers.
const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ['platform:manage', 'users:read', 'users:update', 'orgs:read', 'orgs:update', 'payments:review', 'payments:read_all', 'settings:manage', 'activity:read_all', 'subscriptions:read_all'],
  [ROLES.INDIVIDUAL]: ['tasks:create', 'tasks:manage_own', 'categories:manage', 'payments:submit', 'subscriptions:read_own'],
  [ROLES.ORGANIZATION_OWNER]: ['tasks:create', 'tasks:manage_org', 'categories:manage', 'org:manage', 'teams:manage', 'members:manage', 'invitations:manage', 'payments:submit', 'subscriptions:read_own', 'activity:read_org'],
  [ROLES.ORGANIZATION_MEMBER]: ['tasks:create', 'tasks:update_assigned', 'teams:read_own', 'members:read', 'subscriptions:read_own'],
};

const can = (user, permission) => !!user && (PERMISSIONS[user.role] || []).includes(permission);

const requirePermission = (...perms) => (req, res, next) => {
  if (perms.some((p) => can(req.user, p))) return next();
  return next(new AppError('You do not have permission to perform this action.', 403));
};

module.exports = { PERMISSIONS, can, requirePermission };
