import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { Users, User, Building2, CreditCard, Clock, AlertTriangle, Wallet, TrendingUp, ListChecks, CheckCircle2, Loader, CircleDot, UsersRound, CalendarClock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../components/hooks';
import { PageHeader, StatCard, Skeleton, ErrorState, PriorityBadge, StatusBadge, Badge, EmptyState } from '../components/ui';
import { naira, fmtDate, timeAgo } from '../utils/format';

const GREEN = '#0F6B4F', AMBER = '#E8A317', BLUE = '#2563EB', RED = '#C8412F', GREY = '#9CA8A1';

const Panel = ({ title, action, children }) => (
  <section className="card"><div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold">{title}</h2>{action}</div>{children}</section>
);
const Loading = () => <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;

function TaskList({ tasks, empty }) {
  if (!tasks?.length) return <EmptyState title={empty} text="Tasks you add will show up here." />;
  return <ul className="divide-y divide-line-soft">{tasks.map((t) => (
    <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <div className="min-w-0"><p className="truncate text-sm font-medium">{t.title}</p><p className="text-xs text-ink-mute">{t.dueDate ? `Due ${fmtDate(t.dueDate)}` : 'No due date'}{t.assignedTo ? ` · ${t.assignedTo.name}` : ''}</p></div>
      <div className="flex gap-1.5"><PriorityBadge value={t.priority} /><StatusBadge value={t.status} /></div>
    </li>))}</ul>;
}
function SubCard({ access }) {
  if (!access) return null;
  const iconCls = access.state === 'Active' ? 'text-brand' : access.state === 'Pending' ? 'text-amber' : 'text-danger';
  return (
    <Panel title="Subscription" action={<Link to="/subscription" className="text-sm font-medium text-brand">Manage</Link>}>
      <div className="flex items-center justify-between gap-3 p-4">
        <div><Badge value={access.state === 'None' ? 'Inactive' : access.state} /><p className="mt-2 text-sm text-ink-soft">{access.state === 'Active' ? `Renews or expires ${fmtDate(access.endDate)} (${access.daysLeft} days left)` : access.message}</p></div>
        <CreditCard className={`h-8 w-8 ${iconCls}`} />
      </div>
    </Panel>
  );
}

function TaskDash({ d, kind }) {
  const s = d.stats;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total tasks" value={s.total} icon={ListChecks} />
        <StatCard label="Pending" value={s.pending} icon={CircleDot} tone="neutral" />
        <StatCard label="In progress" value={s.inProgress} icon={Loader} tone="blue" />
        <StatCard label="Completed" value={s.completed} icon={CheckCircle2} />
        <StatCard label="Overdue" value={s.overdue} icon={AlertTriangle} tone={s.overdue ? 'danger' : 'neutral'} />
        {kind !== 'individual' && <StatCard label="Members" value={s.members} icon={Users} tone="blue" />}
        {kind !== 'individual' && <StatCard label="Teams" value={s.teams} icon={UsersRound} tone="amber" />}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Recent tasks" action={<Link to="/tasks" className="text-sm font-medium text-brand">Open tasks</Link>}><TaskList tasks={d.recent} empty="No tasks yet" /></Panel>
        <Panel title="Upcoming deadlines"><TaskList tasks={d.upcoming} empty="Nothing due soon" /></Panel>
      </div>
      {d.teamStats && d.teamStats.length > 0 && (
        <Panel title="Team performance">
          <div className="h-64 p-4"><ResponsiveContainer><BarChart data={d.teamStats}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Legend />
            <Bar dataKey="Pending" stackId="a" fill={GREY} /><Bar dataKey="In Progress" stackId="a" fill={BLUE} /><Bar dataKey="Completed" stackId="a" fill={GREEN} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Panel>)}
      <div className="grid gap-6 lg:grid-cols-2">
        <SubCard access={d.access} />
        {d.recentActivity && <Panel title="Recent activity"><ul className="divide-y divide-line-soft">{d.recentActivity.length === 0 && <li className="p-4 text-sm text-ink-soft">No activity yet.</li>}{d.recentActivity.map((a) => <li key={a._id} className="px-4 py-2.5 text-sm"><span className="font-medium">{a.actorName || 'System'}</span> <span className="text-ink-soft">{a.message}</span> <span className="text-xs text-ink-mute">· {timeAgo(a.createdAt)}</span></li>)}</ul></Panel>}
      </div>
    </div>
  );
}

function AdminDash({ d }) {
  const s = d.stats, c = d.charts;
  const pieColors = { Approved: GREEN, Pending: AMBER, Rejected: RED };
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value={s.totalUsers} icon={Users} hint={`${s.individualUsers} individual`} />
        <StatCard label="Active personal subscriptions" value={s.activeIndividual} icon={User} />
        <StatCard label="Total organizations" value={s.organizations} icon={Building2} tone="blue" />
        <StatCard label="Active business subscriptions" value={s.activeBusiness} icon={CreditCard} tone="blue" />
        <StatCard label="Pending payments" value={s.pendingPayments} icon={Clock} tone="amber" hint={s.pendingPayments ? 'Needs review' : 'All clear'} />
        <StatCard label="Expired subscriptions" value={s.expiredSubscriptions} icon={AlertTriangle} tone="danger" />
        <StatCard label="Revenue this month" value={naira(s.monthRevenue)} icon={Wallet} />
        <StatCard label="Expected monthly revenue" value={naira(s.expectedRevenue)} icon={TrendingUp} tone="neutral" hint="From active subscriptions" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Revenue over time"><div className="h-64 p-4"><ResponsiveContainer><BarChart data={c.revenue}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₦${v / 1000}k`} /><Tooltip formatter={(v) => naira(v)} /><Bar dataKey="value" name="Revenue" fill={GREEN} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
        <Panel title="New users"><div className="h-64 p-4"><ResponsiveContainer><LineChart data={c.newUsers}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Line type="monotone" dataKey="value" name="New users" stroke={BLUE} strokeWidth={2.5} dot /></LineChart></ResponsiveContainer></div></Panel>
        <Panel title="Subscription activity (approved payments)"><div className="h-64 p-4"><ResponsiveContainer><BarChart data={c.subscriptionActivity}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip /><Legend /><Bar dataKey="Personal" fill={GREEN} radius={[4, 4, 0, 0]} /><Bar dataKey="Business" fill={AMBER} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
        <Panel title="Payments by status"><div className="h-64 p-4">{c.paymentsByStatus.length ? <ResponsiveContainer><PieChart><Pie data={c.paymentsByStatus} dataKey="count" nameKey="status" innerRadius={55} outerRadius={85} paddingAngle={2}>{c.paymentsByStatus.map((p) => <Cell key={p.status} fill={pieColors[p.status] || GREY} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer> : <EmptyState title="No payments yet" />}</div></Panel>
      </div>
      <Panel title="Recent platform activity" action={<Link to="/admin/activity" className="text-sm font-medium text-brand">View all</Link>}>
        <ul className="divide-y divide-line-soft">{d.recentActivity.map((a) => <li key={a._id} className="px-4 py-2.5 text-sm"><span className="font-medium">{a.actorName || 'System'}</span> <span className="text-ink-soft">{a.message}</span> <span className="text-xs text-ink-mute">· {timeAgo(a.createdAt)}</span></li>)}</ul>
      </Panel>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, reload, extra } = useFetch('/dashboard');
  const titles = { admin: 'Platform overview', individual: 'My dashboard', organization: user.organization?.name || 'Organization', member: 'My work' };
  const kind = extra?.kind;
  return (
    <>
      <PageHeader title={kind ? titles[kind] : 'Dashboard'} subtitle={`Welcome back, ${user.name.split(' ')[0]}.`} />
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (kind === 'admin' ? <AdminDash d={data} /> : <TaskDash d={data} kind={kind} />)}
    </>
  );
}
