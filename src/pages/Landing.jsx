import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks, Check, Table2, UsersRound, Lock, Bell, FileSpreadsheet, ChevronDown, Menu, X } from 'lucide-react';
import { APP_NAME } from '../layouts/AppLayout';
import { cx, PriorityBadge, StatusBadge } from '../components/ui';

const sample = [
  ['12 Oct', 'Prepare quarterly budget', 'Finance', 'High', 'In Progress', '18 Oct'],
  ['12 Oct', 'Send client proposal', 'Work', 'Urgent', 'Pending', '14 Oct'],
  ['11 Oct', 'Renew car insurance', 'Personal', 'Medium', 'Completed', '13 Oct'],
  ['10 Oct', 'Book dentist appointment', 'Health', 'Low', 'Pending', '25 Oct'],
];
const features = [
  { icon: Table2, title: 'A task grid that feels like a spreadsheet', text: 'Click any cell to edit. Press Enter on the last row to add a task. Export to Excel whenever you need.' },
  { icon: UsersRound, title: 'Teams inside your organization', text: 'Create teams, invite members and assign work to a person or a whole team.' },
  { icon: Lock, title: 'Your data stays yours', text: 'Members only see what they should. If a subscription lapses, nothing is deleted. Your account becomes read-only.' },
  { icon: Bell, title: 'Reminders that arrive on time', text: 'Get notified about assignments, completed work and upcoming renewals.' },
];
const faqs = [
  ['How do I pay?', 'Transfer the monthly fee to the bank account shown in the app, then submit your payment details. We confirm it and activate your subscription.'],
  ['What happens if my subscription expires?', 'You can still log in and see every task, but you cannot add or change anything until you renew. Nothing is ever deleted.'],
  ['Do team members pay separately?', 'No. A Business subscription covers your whole organization and all its members.'],
  ['Can I switch from Personal to Business?', 'Create a Business account with your organization details. Personal and Business accounts are separate.'],
];
const plans = [
  { name: 'Personal', price: '₦2,000', text: 'For one person managing their own tasks.', items: ['Unlimited personal tasks', 'Custom categories', 'Spreadsheet-style task grid', 'Task history and statistics', 'Excel and CSV export'], cta: 'Start with Personal', to: '/register?type=personal' },
  { name: 'Business', price: '₦5,000', text: 'For a company, church, school or agency.', items: ['Everything in Personal', 'Teams inside your organization', 'Invite unlimited members', 'Assign tasks to people or teams', 'Organization dashboard and activity log'], cta: 'Start with Business', to: '/register?type=business', featured: true },
];

export default function Landing() {
  const [open, setOpen] = useState(null);
  const [menu, setMenu] = useState(false);
  const links = [['How it works', '#how'], ['Features', '#features'], ['Pricing', '#pricing'], ['FAQ', '#faq']];
  return (
    <div className="min-h-full bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2"><div className="rounded-lg bg-brand p-1.5 text-white"><ListChecks className="h-5 w-5" /></div><span className="font-display text-xl font-bold">{APP_NAME}</span></Link>
          <nav className="hidden items-center gap-6 text-sm text-ink-soft md:flex">{links.map(([l, h]) => <a key={h} href={h} className="hover:text-ink">{l}</a>)}</nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="btn-ghost hidden sm:inline-flex">Login</Link>
            <Link to="/register" className="btn-primary">Get Started</Link>
            <button className="rounded-lg p-2 md:hidden" onClick={() => setMenu(!menu)} aria-label="Menu">{menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {menu && <div className="border-t border-line bg-white px-4 py-3 md:hidden">{[...links, ['Login', '/login']].map(([l, h]) => <a key={h} href={h} onClick={() => setMenu(false)} className="block py-2 text-sm">{l}</a>)}</div>}
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 lg:grid-cols-[1fr_1.15fr] lg:pt-20">
        <div>
          <h1 className="text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">Manage Your Tasks. Stay Organized. Get Things Done.</h1>
          <p className="mt-5 max-w-lg text-lg text-ink-soft">{APP_NAME} gives you a fast, spreadsheet-style task list for yourself or your whole organization. Set priorities, assign work to teams and never lose track of a deadline.</p>
          <div className="mt-7 flex flex-wrap gap-3"><Link to="/register" className="btn-primary !px-6 !py-3 text-base">Get Started</Link><Link to="/login" className="btn-secondary !px-6 !py-3 text-base">Login</Link></div>
          <p className="mt-4 text-sm text-ink-mute">From ₦2,000 a month. Pay by bank transfer.</p>
        </div>
        <div className="card overflow-hidden shadow-pop" aria-hidden>
          <div className="flex items-center gap-1.5 border-b border-line bg-paper px-3 py-2"><span className="h-2.5 w-2.5 rounded-full bg-danger/60" /><span className="h-2.5 w-2.5 rounded-full bg-amber" /><span className="h-2.5 w-2.5 rounded-full bg-brand" /><span className="ml-3 text-xs text-ink-mute">My tasks</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
            <thead><tr className="bg-paper text-ink-soft">{['Date', 'Task', 'Category', 'Priority', 'Status', 'Due'].map((h) => <th key={h} className="border-b border-r border-line px-3 py-2 font-semibold last:border-r-0">{h}</th>)}</tr></thead>
            <tbody>{sample.map((r, i) => <tr key={i} className={i === 1 ? 'bg-brand-light/60' : ''}>{r.map((c, j) => <td key={j} className={cx('border-b border-r border-line-soft px-3 py-2.5 last:border-r-0', i === 1 && j === 1 && 'ring-2 ring-inset ring-brand')}>{j === 3 ? <PriorityBadge value={c} /> : j === 4 ? <StatusBadge value={c} /> : c}</td>)}</tr>)}</tbody>
          </table></div>
        </div>
      </section>

      <section id="how" className="border-y border-line bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold">How it works</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {[['Create your account', 'Choose Personal or Business. Businesses add their organization details in a short setup.'], ['Subscribe by bank transfer', 'Pay the monthly fee, submit the payment details, and we activate your account once it is confirmed.'], ['Start managing tasks', 'Add tasks in the grid, set priorities and due dates, and invite your team if you are on Business.']].map(([t, d], i) => (
              <li key={t} className="flex gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand font-display font-bold text-white">{i + 1}</span><div><h3 className="text-lg font-semibold">{t}</h3><p className="mt-1 text-sm text-ink-soft">{d}</p></div></li>))}
          </ol>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold">Features</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">{features.map(({ icon: I, title, text }) => (
          <div key={title} className="card p-5"><I className="mb-3 h-6 w-6 text-brand" /><h3 className="text-lg font-semibold">{title}</h3><p className="mt-1 text-sm text-ink-soft">{text}</p></div>))}</div>
      </section>

      <section id="pricing" className="border-y border-line bg-white py-16">
        <div className="mx-auto max-w-4xl px-4">
          <h2 className="text-3xl font-bold">Pricing</h2>
          <p className="mt-2 text-ink-soft">Two plans. Billed monthly. No hidden charges.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">{plans.map((p) => (
            <div key={p.name} className={cx('card flex flex-col p-6', p.featured && 'border-brand ring-2 ring-brand/20')}>
              <h3 className="text-xl font-semibold">{p.name}</h3><p className="mt-1 text-sm text-ink-soft">{p.text}</p>
              <p className="mt-4"><span className="font-display text-4xl font-bold">{p.price}</span><span className="text-ink-soft"> / month</span></p>
              <ul className="my-5 flex-1 space-y-2 text-sm">{p.items.map((i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />{i}</li>)}</ul>
              <Link to={p.to} className={p.featured ? 'btn-primary' : 'btn-secondary'}>{p.cta}</Link>
            </div>))}</div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold">Why use {APP_NAME}</h2>
        <div className="mt-6 grid gap-6 text-ink-soft md:grid-cols-3">
          <p><strong className="text-ink">Fast.</strong> Type a task, press Enter, move on. No forms to fill in for everyday work.</p>
          <p><strong className="text-ink">Clear.</strong> Overdue work turns red. Priorities and statuses are colour-coded so you see what matters first.</p>
          <p><strong className="text-ink">Safe.</strong> Your tasks are never deleted when a subscription ends. Renew whenever you are ready and carry on.</p>
        </div>
      </section>

      <section id="faq" className="border-t border-line bg-white py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-3xl font-bold">Frequently asked questions</h2>
          <div className="mt-6 divide-y divide-line rounded-xl border border-line">{faqs.map(([q, a], i) => (
            <div key={q}><button className="flex w-full items-center justify-between px-5 py-4 text-left font-medium" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{q}<ChevronDown className={cx('h-4 w-4 transition-transform', open === i && 'rotate-180')} /></button>{open === i && <p className="px-5 pb-4 text-sm text-ink-soft">{a}</p>}</div>))}</div>
        </div>
      </section>

      <footer className="bg-ink py-10 text-white/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm">
          <div className="flex items-center gap-2 text-white"><ListChecks className="h-5 w-5" /><span className="font-display text-lg font-bold">{APP_NAME}</span></div>
          <div className="flex gap-5"><Link to="/login" className="hover:text-white">Login</Link><Link to="/register" className="hover:text-white">Get Started</Link><a href="#pricing" className="hover:text-white">Pricing</a></div>
          <p>© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
