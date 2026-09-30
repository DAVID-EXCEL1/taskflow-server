import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import { Login, Register, AcceptInvite } from './pages/AuthPages';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Categories from './pages/Categories';
import { Teams, Members, Organization } from './pages/OrgPages';
import Subscription from './pages/Subscription';
import { Notifications, Profile, ActivityPage } from './pages/Misc';
import AdminUsers from './pages/admin/Users';
import { AdminOrganizations, AdminSubscriptions } from './pages/admin/Organizations';
import AdminPayments from './pages/admin/Payments';
import AdminSettings from './pages/admin/Settings';

const homeFor = (u) => (u.role === 'SUPER_ADMIN' ? '/admin' : '/dashboard');

function Guard({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-brand" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />;
  return children;
}
function Home() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to={homeFor(user)} replace /> : <Landing />;
}
function GuestOnly({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to={homeFor(user)} replace /> : children;
}

const CUSTOMER = ['INDIVIDUAL', 'ORGANIZATION_OWNER', 'ORGANIZATION_MEMBER'];
const ORG = ['ORGANIZATION_OWNER', 'ORGANIZATION_MEMBER'];
const ADMIN = ['SUPER_ADMIN'];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route element={<Guard><AppLayout /></Guard>}>
        <Route path="/dashboard" element={<Guard roles={CUSTOMER}><Dashboard /></Guard>} />
        <Route path="/tasks" element={<Guard roles={CUSTOMER}><Tasks /></Guard>} />
        <Route path="/categories" element={<Guard roles={['INDIVIDUAL', 'ORGANIZATION_OWNER']}><Categories /></Guard>} />
        <Route path="/teams" element={<Guard roles={ORG}><Teams /></Guard>} />
        <Route path="/members" element={<Guard roles={ORG}><Members /></Guard>} />
        <Route path="/organization" element={<Guard roles={['ORGANIZATION_OWNER']}><Organization /></Guard>} />
        <Route path="/activity" element={<Guard roles={['ORGANIZATION_OWNER']}><ActivityPage /></Guard>} />
        <Route path="/subscription" element={<Guard roles={CUSTOMER}><Subscription /></Guard>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<Guard roles={ADMIN}><Dashboard /></Guard>} />
        <Route path="/admin/users" element={<Guard roles={ADMIN}><AdminUsers /></Guard>} />
        <Route path="/admin/organizations" element={<Guard roles={ADMIN}><AdminOrganizations /></Guard>} />
        <Route path="/admin/subscriptions" element={<Guard roles={ADMIN}><AdminSubscriptions /></Guard>} />
        <Route path="/admin/payments" element={<Guard roles={ADMIN}><AdminPayments /></Guard>} />
        <Route path="/admin/activity" element={<Guard roles={ADMIN}><ActivityPage /></Guard>} />
        <Route path="/admin/settings" element={<Guard roles={ADMIN}><AdminSettings /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
