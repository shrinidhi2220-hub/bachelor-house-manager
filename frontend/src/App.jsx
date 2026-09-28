import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fcmConfigured, registerForPush, listenForForegroundPush, PUSH_TOKEN_KEY } from './fcm.js';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:10000/api';
const TOKEN_KEY = 'bhm_token_v6';
const USER_KEY = 'bhm_user_v6';

const NAV = [
  ['dashboard', '⌂', "Today's House"],
  ['mytasks', '✓', 'My Tasks'],
  ['schedule', '▦', '7-Day Rotation'],
  ['expenses', '₹', 'Expenses'],
  ['groceries', '🛒', 'Groceries'],
  ['meals', '🍲', 'Meal Planner'],
  ['attendance', '◷', 'Availability & Leave'],
  ['announcements', '📣', 'House Board'],
  ['maintenance', '🔧', 'Maintenance'],
  ['inventory', '📦', 'House Inventory'],
  ['fairness', '◌', 'Fairness Analytics'],
  ['security', '🛡', 'Security'],
  ['messages', '✉', 'WhatsApp & Notifications'],
  ['members', '👥', 'Members'],
  ['settings', '⚙', 'Settings'],
  ['profile', '◉', 'My Profile'],
];

function money(n) { return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`; }
function fmtDate(d) { try { return new Date(`${d}T12:00:00`).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }); } catch { return d; } }
function fmtTime(t) { const [h,m] = String(t || '').split(':').map(Number); if (!Number.isFinite(h)) return t; const suffix = h >= 12 ? 'PM' : 'AM'; return `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${suffix}`; }

async function api(path, token, options = {}) {
  const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type || 'success'}`}><span>{toast.type === 'error' ? '⚠️' : toast.type === 'warning' ? '🔔' : '✓'}</span>{toast.message}</div>;
}


function StartupExperience({ onStart }) {
  const imageSrc = '/cinematic/bachelor-house-final-hero-4k.jpg';
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  const handleStart = () => {
    sessionStorage.setItem('bhm_startup_seen', '1');
    onStart();
  };

  return (
    <div className={`startup-cinematic-final ${entered ? 'entered' : ''}`} role="dialog" aria-label="Bachelor House Manager introduction">
      <div className="startup-final-frame">
        <img
          className="startup-final-image"
          src={imageSrc}
          alt="Bachelor House Manager — five roommates sharing one home"
          draggable="false"
        />
        <button
          type="button"
          className="startup-final-cta-hotspot"
          aria-label="Get Started with Bachelor House Manager"
          onClick={handleStart}
        >
          <span className="sr-only">Get Started</span>
        </button>
      </div>
    </div>
  );
}
function AuthScreen({ onAuth, notice }) {
  const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') || '';
  const [mode, setMode] = useState(inviteFromUrl ? 'join' : 'login');
  const [form, setForm] = useState({ name:'', username:'', password:'', phone:'', email:'', inviteCode:inviteFromUrl, houseName:'', capacity:5 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (mode === 'login') {
        const d = await api('/auth/login', null, { method:'POST', body: JSON.stringify({ username:form.username, password:form.password }) });
        localStorage.setItem(TOKEN_KEY, d.token); localStorage.setItem(USER_KEY, JSON.stringify(d.user)); onAuth(d.user, d.token); return;
      }
      const body = { ...form, mode };
      const d = await api('/auth/register', null, { method:'POST', body: JSON.stringify(body) });
      localStorage.setItem(TOKEN_KEY, d.token); localStorage.setItem(USER_KEY, JSON.stringify(d.user)); onAuth(d.user, d.token);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return <div className="auth-shell">
    <div className="auth-card">
      <div className="brand-mark">🏠</div>
      <div className="eyebrow">BACHELOR HOUSE OS · PUBLIC</div>
      <h1>Run your house smarter.</h1>
      <p className="muted">Create a house for your group, or join an existing one. Every house has isolated data, roles and schedules.</p>
      {notice && <div className={`notice ${notice.type==='error'?'error-box':''}`}><strong>{notice.message}</strong></div>}
      <div className="switcher">
        <button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>Login</button>
        <button className={mode==='create'?'active':''} onClick={()=>{setMode('create');setError('')}}>Create House</button>
        <button className={mode==='join'?'active':''} onClick={()=>{setMode('join');setError('')}}>Join House</button>
      </div>
      <form onSubmit={submit} className="stack">
        {mode !== 'login' && <Field label="Your name" value={form.name} onChange={v=>set('name',v)} placeholder="Your full name" />}
        <Field label="Username" value={form.username} onChange={v=>set('username',v)} placeholder="yourname" />
        <Field label="Password" type="password" value={form.password} onChange={v=>set('password',v)} placeholder="Minimum 8 characters" />
        {mode !== 'login' && <Field label="WhatsApp / mobile number" value={form.phone} onChange={v=>set('phone',v)} placeholder="9876543210 or +919876543210" />}
        {mode !== 'login' && <Field label="Email address" value={form.email} onChange={v=>set('email',v)} placeholder="you@example.com" />}
        {mode === 'create' && <>
          <Field label="House name" value={form.houseName} onChange={v=>set('houseName',v)} placeholder="My Bachelor House" />
          <Select label="House capacity" value={String(form.capacity)} onChange={v=>set('capacity',Number(v))} options={['2','3','4','5','6','8','10','15','20'].map(x=>[x,`${x} members`])} />
        </>}
        {mode === 'join' && <Field label="House invite code" value={form.inviteCode} onChange={v=>set('inviteCode',v.toUpperCase())} placeholder="BH-XXXXXXXX" />}
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Enter House' : mode === 'create' ? 'Create House' : 'Join House'}</button>
      </form>
      <div className="admin-hint"><strong>How it works:</strong> the person who creates a house becomes its Admin. Joining users are normal Members. Your house data is isolated from every other house.</div>
    </div>
  </div>;
}

function Field({ label, value, onChange, type='text', placeholder='' }) {
  return <label className="field"><span>{label}</span><input type={type} value={value ?? ''} onChange={e=>onChange(e.target.value)} placeholder={placeholder} /></label>;
}
function Select({ label, value, onChange, options }) { return <label className="field"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>; }
function Button({ children, onClick, variant='', disabled=false }) { return <button className={`btn ${variant}`} onClick={onClick} disabled={disabled}>{children}</button>; }
function Card({ children, className='' }) { return <section className={`card ${className}`}>{children}</section>; }
function SectionTitle({ eyebrow, title, subtitle, right }) { return <div className="section-title"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>{right}</div>; }

function App() {
  const [showStartup, setShowStartup] = useState(() => sessionStorage.getItem('bhm_startup_seen') !== '1');
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem(USER_KEY) || 'null'));
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [active, setActive] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState(null);
  const [data, setData] = useState({ house:null, members:[], today:[], week:[], expenses:[], expenseArchives:[], expenseMonth:'', expenseCurrentTotal:0, expenseCurrentEntryCount:0, groceries:[], meals:[], announcements:[], maintenance:[], inventory:[], leaveRequests:[], notifications:[], swaps:[], analytics:null, automation:null, history:[], profiles:[], security:null });
  const isAdmin = user?.role === 'ADMIN';
  const memberTabs = ['dashboard','mytasks','expenses','groceries','meals','attendance','announcements','maintenance','inventory','fairness','profile'];

  if (showStartup) {
    return <StartupExperience onStart={() => { sessionStorage.setItem('bhm_startup_seen', '1'); setShowStartup(false); }} />;
  }

  const notify = (message, type='success') => { setToast({message,type}); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(()=>setToast(null), 3500); };
  const call = async (path, options={}) => api(path, token, options);

  const enablePushNotifications = async () => {
    try {
      if (!fcmConfigured()) { notify('Push notifications are not configured yet. Add the Firebase web keys in frontend/.env.', 'warning'); return false; }
      const result = await registerForPush();
      if (!result.enabled || !result.token) { notify(result.reason || 'Push notifications were not enabled.', 'warning'); return false; }
      await call('/notifications/device', { method:'POST', body:JSON.stringify({ token:result.token, platform:'web' }) });
      notify('Push notifications enabled on this device ✅');
      await loadData();
      return true;
    } catch (error) { notify(error.message, 'error'); return false; }
  };

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const common = await Promise.all([
        call('/today'), call('/history'), call('/swaps'), call('/announcements'), call('/notifications'),
        call('/expenses'), call('/groceries'), call('/meals'), call('/maintenance'), call('/inventory'), call('/leave'), call('/fairness'), call('/profile/members'),
        isAdmin ? call('/security/status') : Promise.resolve(null)
      ]);
      const [today, history, swaps, announcements, notifications, expenses, groceries, meals, maintenance, inventory, leave, fairness, profiles, security] = common;
      const base = {
        house:today.house,
        members:today.members,
        today:today.assignments,
        week:[],
        history:history.history,
        swaps:swaps.swapRequests,
        announcements:announcements.announcements,
        notifications:notifications.notifications,
        expenses:expenses.expenses || [],
        expenseArchives:expenses.archives || [],
        expenseMonth:expenses.currentMonth || '',
        expenseCurrentTotal:Number(expenses.currentTotal || 0),
        expenseCurrentEntryCount:Number(expenses.currentEntryCount || 0),
        groceries:groceries.groceries || [],
        meals:meals.meals || [],
        maintenance:maintenance.maintenance || [],
        inventory:inventory.inventory || [],
        leaveRequests:leave.leaveRequests || [],
        analytics:fairness,
        profiles:profiles.members || [],
        security
      };
      if (isAdmin) {
        const adminResults = await Promise.allSettled([
          call('/schedule'), call('/analytics'), call('/automation/status'), call('/automation/messages')
        ]);
        const val = i => adminResults[i].status === 'fulfilled' ? adminResults[i].value : {};
        Object.assign(base, { week:val(0).days || [], adminAnalytics:val(1), automation:val(2), messages:val(3).messages || [] });
      }
      setData(prev => ({...prev, ...base}));
    } catch (err) {
      if (err.message.includes('Authentication')) logout(false); else notify(err.message, 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const verify = new URLSearchParams(window.location.search).get('verify');
    if (verify) {
      fetch(`${API_BASE}/auth/verify-email?token=${encodeURIComponent(verify)}`)
        .then(r=>r.json().then(d=>({ok:r.ok,...d})))
        .then(d=>{ const message=d.message || d.error || 'Email verification complete.'; setVerifyNotice({message,type:d.ok?'success':'error'}); if (user && token) notify(message,d.ok?'success':'error'); })
        .catch(()=>notify('Email verification failed.', 'error'));
      const url = new URL(window.location.href); url.searchParams.delete('verify'); window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    let cleanup = () => {};
    if (user && token && fcmConfigured()) {
      listenForForegroundPush(payload => {
        const title = payload?.notification?.title || 'House notification';
        const body = payload?.notification?.body || 'You have a new notification.';
        notify(`${title}: ${body}`, 'info');
      }).then(fn => { cleanup = fn || (()=>{}); }).catch(()=>{});
    }
    return () => { try { cleanup(); } catch {} };
  }, [user?.id, token]);

  useEffect(() => { if (user && token) loadData(); }, [user?.id, token]);
  useEffect(() => {
    if (!user || !token || !fcmConfigured() || !('Notification' in window) || Notification.permission !== 'granted') return;
    (async()=>{
      try {
        const result = await registerForPush();
        if (result.enabled && result.token) await call('/notifications/device',{method:'POST',body:JSON.stringify({token:result.token,platform:'web'})});
      } catch {}
    })();
  }, [user?.id, token]);

  useEffect(() => { if (!isAdmin && !memberTabs.includes(active)) setActive('dashboard'); }, [active, isAdmin]);

  const authenticate = (u,t) => { setUser(u); setToken(t); };
  const logout = async (notifyUser=true) => { try { const pushToken = localStorage.getItem(PUSH_TOKEN_KEY); if (pushToken && token) await call('/notifications/device',{method:'DELETE',body:JSON.stringify({token:pushToken})}); if (token) await call('/auth/logout',{method:'POST'}); } catch {} localStorage.removeItem(PUSH_TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); setUser(null); setToken(''); if (notifyUser) notify('Logged out'); };
  if (!user || !token) return <AuthScreen onAuth={authenticate} notice={verifyNotice} />;

  const go = id => { if (isAdmin || memberTabs.includes(id)) setActive(id); };
  const member = data.members.find(m => m.id === user.memberId) || { name:user.name, phone:user.phone, email:user.email, avatar:user.avatar };

  return <div className="app-shell"><Toast toast={toast}/>
    <aside className="sidebar">
      <div className="side-top">
        <div className="house-chip"><span>🏠</span><div><strong>{data.house?.name || 'Your House'}</strong><small>{data.members.length}/{data.house?.capacity || 5} members</small></div></div>
        <div className={`role-chip ${isAdmin?'admin':'member'}`}>{isAdmin?`👑 ${member.name || user.name} · ADMIN`:'👤 ROOMMATE'}</div>
        <nav>{NAV.filter(([id])=>isAdmin || memberTabs.includes(id)).map(([id,icon,label])=>{
          const badge = id==='mytasks' ? data.today.filter(a=>a.assignedToMemberId===user.memberId && a.status==='pending').length : 0;
          return <button key={id} className={active===id?'nav active':'nav'} onClick={()=>go(id)}><span>{icon}</span><span>{label}</span>{badge>0&&<b>{badge}</b>}</button>;
        })}</nav>
      </div>
      <div className="side-bottom">
        {isAdmin && <button className="logout" onClick={()=>setInviteOpen(true)}>📩 Invite roommates</button>}
        <button className="profile profile-link" onClick={()=>go('profile')}>
          <div className="avatar avatar-photo" style={member.avatar?{backgroundImage:`url(${member.avatar})`}:undefined}>{!member.avatar&&(member.name||'U').slice(0,1).toUpperCase()}</div>
          <div><strong>{member.name || user.name}</strong><small>{member.phone || 'No mobile number'}{member.email ? ` · ${member.email}` : ''}</small></div>
        </button>
        <button className="logout" onClick={()=>logout()}>Logout ↗</button>
      </div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="live-dot"></span> House system online</div><div className="top-actions">{loading && <span className="muted">Syncing…</span>}<button className="icon-btn" onClick={loadData}>↻</button><span className="today-pill">{new Date().toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})}</span></div></header>
      <div className="content">
        {active==='dashboard' && <Dashboard data={data} user={user} isAdmin={isAdmin} call={call} notify={notify} reload={loadData} go={go} onInvite={()=>setInviteOpen(true)}/>}
        {active==='mytasks' && <MyTasks data={data} user={user} call={call} notify={notify} reload={loadData}/>} 
        {isAdmin && active==='schedule' && <Schedule data={data} isAdmin={isAdmin} call={call} notify={notify} reload={loadData}/>} 
        {active==='expenses' && <Expenses data={data} call={call} notify={notify} reload={loadData} isAdmin={isAdmin}/>} 
        {active==='groceries' && <Groceries data={data} call={call} notify={notify} reload={loadData}/>} 
        {active==='meals' && <Meals data={data} call={call} notify={notify} reload={loadData} isAdmin={isAdmin}/>} 
        {active==='attendance' && <Attendance data={data} call={call} notify={notify} reload={loadData} isAdmin={isAdmin}/>} 
        {active==='announcements' && <Announcements data={data} call={call} notify={notify} reload={loadData} isAdmin={isAdmin}/>} 
        {active==='maintenance' && <Maintenance data={data} call={call} notify={notify} reload={loadData} isAdmin={isAdmin}/>} 
        {active==='inventory' && <Inventory data={data} call={call} notify={notify} reload={loadData} isAdmin={isAdmin}/>} 
        {active==='fairness' && <Fairness data={data}/>} 
        {isAdmin && active==='security' && <Security data={data} user={user} call={call} notify={notify} reload={loadData} enablePush={enablePushNotifications}/>}
        {isAdmin && active==='messages' && <Messages data={data} call={call} notify={notify} reload={loadData}/>} 
        {isAdmin && active==='members' && <Members data={data} call={call} notify={notify} reload={loadData}/>} 
        {isAdmin && active==='settings' && <Settings data={data} call={call} notify={notify} reload={loadData}/>} 
        {active==='profile' && <Profile data={data} user={user} call={call} notify={notify} reload={loadData}/>} 
      </div>
    </main>
    {inviteOpen && isAdmin && <InviteModal data={data} call={call} notify={notify} onClose={()=>setInviteOpen(false)}/>} 
  </div>;
}

function Dashboard({data,user,isAdmin,call,notify,reload,go,onInvite}) {
  const mine = data.today.filter(a=>a.assignedToMemberId===user.memberId);
  const pending = data.today.filter(a=>a.status==='pending');
  const done = data.today.filter(a=>a.status==='completed');
  const sent = data.automation?.messageSummary?.sent ?? 0;
  const failed = data.automation?.messageSummary?.failed ?? 0;
  const latestAnnouncement = data.announcements?.[0];
  return <div className="stack-lg">
    <SectionTitle eyebrow="HOUSE CONTROL" title={`Good day, ${user.name}`} subtitle={isAdmin?'You manage the whole house. Members, schedules and notifications are controlled from one place.':'Your house workspace shows the shared house information and your own actionable tasks.'} right={isAdmin?<div className="row"><Button variant="primary" onClick={async()=>{try{const r=await call('/automation/run-now',{method:'POST'}); notify(`Schedule ready. ${r.messageResult?.queued ?? 0} WhatsApp messages queued.`); await reload();}catch(e){notify(e.message,'error')}}}>⚡ Generate + Send</Button><Button onClick={onInvite}>📩 Invite</Button></div>:null}/>
    {isAdmin && data.members.length<(data.house?.capacity || 5) && <Card className="notice"><div className="notice-icon">👥</div><div><strong>{(data.house?.capacity || 5)-data.members.length} member slot{(data.house?.capacity || 5)-data.members.length===1?'':'s'} open</strong><p>Share the invitation link. Each roommate creates their own account, phone and profile.</p></div><Button variant="primary" onClick={onInvite}>Invite now</Button></Card>}
    {isAdmin && <div className="metric-grid"><Metric label="Members" value={`${data.members.length}/${data.house?.capacity || 5}`} hint="Real joined accounts" icon="👥"/><Metric label="Today's chores" value={data.today.length} hint={`${done.length} completed`} icon="✓"/><Metric label="WhatsApp" value={sent} hint={failed?`${failed} failed`:'No failures today'} icon="✉" tone={failed?'warn':''}/><Metric label="Open items" value={(data.groceries||[]).filter(g=>g.status==='open').length+(data.maintenance||[]).filter(m=>m.status!=='fixed').length} hint="Groceries + maintenance" icon="•"/></div>}
    <div className="grid-2">
      <Card><div className="card-head"><div><h3>Today’s House</h3><p className="muted">{isAdmin?'All house assignments.':'Shared house schedule plus your assigned work.'}</p></div></div><TaskList assignments={isAdmin?data.today:mine} members={data.members} ownId={user.memberId} call={call} notify={notify} reload={reload} isAdmin={isAdmin}/></Card>
      <div className="stack-md">
        <Card><div className="card-head"><div><h3>House Pulse</h3><p className="muted">Backend-backed status.</p></div></div><div className="pulse-list"><Pulse label="Today's schedule" value={data.today.length?'READY':'WAITING'} ok={!!data.today.length}/><Pulse label="Automation" value={isAdmin?(data.automation?.dailyTime ? `${data.automation.dailyTime} ${data.automation.timezone||'IST'}`:'06:00 IST'):'SERVER ACTIVE'}/><Pulse label="WhatsApp" value={isAdmin?(data.automation?.whatsappConfigured?'Configured':'Needs Twilio'):'Per-profile routing'} ok={!isAdmin || data.automation?.whatsappConfigured}/><Pulse label="House members" value={`${data.members.length}/${data.house?.capacity || 5}`}/></div></Card>
        <Card><div className="card-head"><div><h3>House People</h3><p className="muted">Tap a person to view their profile.</p></div><Button onClick={()=>go('profile')}>Open profiles</Button></div>{data.profiles.map(p=><button key={p.id} className="person-chip" onClick={()=>go('profile')}><div className="avatar" style={p.avatar?{backgroundImage:`url(${p.avatar})`}:undefined}>{!p.avatar&&(p.name||'U').slice(0,1).toUpperCase()}</div><div><strong>{p.name}</strong><small>{p.role} · {p.phone||'No mobile'}</small></div></button>)}{!data.profiles.length&&<Empty text="No house members yet."/>}</Card>
        <Card><div className="card-head"><div><h3>Latest House Board</h3><p className="muted">Announcements for everyone.</p></div>{isAdmin&&<Button onClick={()=>go('announcements')}>Manage</Button>}</div>{latestAnnouncement?<div className="announcement"><strong>{latestAnnouncement.title}</strong><p>{latestAnnouncement.message}</p><small>{new Date(latestAnnouncement.createdAt).toLocaleString('en-IN')}</small></div>:<Empty text="No announcements yet."/>}</Card>
      </div>
    </div>
  </div>;
}
function Metric({label,value,hint,icon,tone=''}){return <div className={`metric ${tone}`}><div className="metric-icon">{icon}</div><div><small>{label}</small><strong>{value}</strong><span>{hint}</span></div></div>}
function Pulse({label,value,ok}){return <div className="pulse"><span className={ok===false?'dot warn':'dot'}></span><span>{label}</span><strong>{value}</strong></div>}

function MyTasks({data,user,call,notify,reload}) { const mine=data.today.filter(a=>a.assignedToMemberId===user.memberId); return <div className="stack-lg"><SectionTitle eyebrow="MY TASKS" title={`My tasks · ${user.name}`} subtitle="Only tasks assigned to your account are actionable."/><Card><TaskList assignments={mine} members={data.members} ownId={user.memberId} call={call} notify={notify} reload={reload} isAdmin={false}/></Card></div>; }

function TaskList({assignments,members,ownId,call,notify,reload,isAdmin}) { if(!assignments.length) return <Empty text="No tasks currently assigned. The next backend schedule run will populate the rotation."/>; return <div className="task-list">{assignments.map(a=>{const m=members.find(x=>x.id===a.assignedToMemberId); const mine=a.assignedToMemberId===ownId; return <div className={`task ${a.status==='completed'?'done':''}`} key={a.id}><div className="task-icon">{a.icon}</div><div className="task-main"><div className="task-title"><strong>{a.taskName}</strong><span className="tag">{a.effort} pts</span>{mine&&<span className="tag blue">YOU</span>}</div><div className="task-meta">{fmtTime(a.time)} · {a.category} · {m?.name||'Unassigned'}</div><small>{a.explanation || 'Backend assignment'}</small></div><div className="task-actions">{a.status==='completed'?<span className="status done">Completed</span>:mine||isAdmin?<Button variant="success" onClick={async()=>{try{await call(`/tasks/${a.id}/complete`,{method:'POST'});notify(`Completed ${a.taskName}`);await reload();}catch(e){notify(e.message,'error')}}}>Done</Button>:<span className="status">Pending</span>}</div></div>})}</div>; }

function Schedule({data,isAdmin,call,notify,reload}) { return <div className="stack-lg"><SectionTitle eyebrow="ROTATION" title="7-Day Household Rotation" subtitle="Seven days are generated and stored by the backend; restarting the server does not duplicate a day." right={isAdmin?<Button variant="primary" onClick={async()=>{try{const r=await call('/schedule/generate',{method:'POST',body:JSON.stringify({force:true})});notify(`7-day schedule regenerated (${r.weekly.length} assignments).`);await reload();}catch(e){notify(e.message,'error')}}}>Regenerate 7 days</Button>:null}/><div className="week-grid">{data.week.map(day=><Card key={day.date} className="day-card"><div className="day-head"><div><strong>{day.day}</strong><small>{fmtDate(day.date)}</small></div><span>{day.assignments.length} chores</span></div>{day.assignments.length?<div className="day-tasks">{day.assignments.map(a=>{const m=data.members.find(x=>x.id===a.assignedToMemberId);return <div key={a.id}><span>{a.icon}</span><div><strong>{a.taskName}</strong><small>{fmtTime(a.time)} · {m?.name||'—'}</small></div><em className={a.status==='completed'?'complete':''}>{a.status}</em></div>})}</div>:<Empty text="No schedule for this day yet."/>}</Card>)}</div></div>; }

function monthLabel(month) {
  if (!month) return 'Unknown month';
  const [y,m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m-1, 1)).toLocaleDateString('en-IN', { month:'long', year:'numeric', timeZone:'UTC' });
}

function Expenses({data,call,notify,reload,isAdmin}) {
  const [form,setForm]=useState({title:'',amount:'',category:'Groceries'});
  const [editingId,setEditingId]=useState('');
  const [saving,setSaving]=useState(false);
  const currentMonth = data.expenseMonth || new Date().toISOString().slice(0,7);
  const total = Number(data.expenseCurrentTotal ?? data.expenses.reduce((s,e)=>s+Number(e.amount||0),0));
  const entries = Number(data.expenseCurrentEntryCount ?? data.expenses.length);
  const shares = total / Math.max(1, data.members.length);
  const archives = data.expenseArchives || [];

  const resetForm = () => { setForm({title:'',amount:'',category:'Groceries'}); setEditingId(''); };

  const saveExpense = async () => {
    try {
      const amount = Number(form.amount);
      if (!form.title.trim() || !Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid title and non-negative amount.');
      setSaving(true);
      if (editingId) {
        if (!isAdmin) throw new Error('Only the house creator can edit an expense.');
        await call(`/expenses/${editingId}`,{method:'PATCH',body:JSON.stringify({title:form.title,amount,category:form.category})});
        notify('Expense updated.');
      } else {
        await call('/expenses',{method:'POST',body:JSON.stringify({...form,amount})});
        notify('Expense recorded for this month.');
      }
      resetForm();
      await reload();
    } catch(e) { notify(e.message,'error'); } finally { setSaving(false); }
  };

  const beginEdit = e => {
    if (!isAdmin) return;
    setEditingId(e.id);
    setForm({title:e.title||'',amount:String(e.amount ?? ''),category:e.category||'Other'});
    window.scrollTo({top:0,behavior:'smooth'});
  };

  const deleteExpense = async e => {
    if (!isAdmin) return;
    const ok = window.confirm(`Delete expense “${e.title}” (${money(e.amount)})? This cannot be undone.`);
    if (!ok) return;
    try {
      await call(`/expenses/${e.id}`,{method:'DELETE'});
      if (editingId===e.id) resetForm();
      notify('Expense deleted.');
      reload();
    } catch(err) { notify(err.message,'error'); }
  };

  const archivePrevious = async () => {
    try {
      await call('/expenses/archive',{method:'POST',body:JSON.stringify({})});
      notify('Previous month archived. The current month stays separate.');
      reload();
    } catch(e) { notify(e.message,'error'); }
  };

  return <div className="stack-lg">
    <SectionTitle
      eyebrow="MONEY"
      title="House Expenses"
      subtitle={isAdmin ? "Everyone can add current-month expenses. Only the house creator can edit or delete them." : "You can add current-month expenses. The house creator manages edits and deletions."}
      right={isAdmin ? <Button onClick={archivePrevious}>Archive Previous Month</Button> : null}
    />

    <div className="metric-grid">
      <Metric label={monthLabel(currentMonth)} value={money(total)} hint={`${entries} current-month entries`} icon="₹" />
      <Metric label="Equal share" value={money(shares)} hint={`${data.members.length} current members`} icon="÷" />
      <Metric label="Current entries" value={entries} hint="Only this month" icon="#" />
      <Metric label="Archived months" value={archives.length} hint="Saved house history" icon="▣" />
    </div>

    <div className="grid-2">
      <Card>
        <div className="card-head">
          <div>
            <h3>{editingId ? 'Edit expense' : 'Add expense'} · {monthLabel(currentMonth)}</h3>
            <p className="muted">Paid-by identity is taken from the authenticated member. Previous months are read-only archives.</p>
          </div>
          {editingId && isAdmin && <Button variant="ghost" onClick={resetForm}>Cancel</Button>}
        </div>
        <div className="form-grid">
          <Field label="Title" value={form.title} onChange={v=>setForm({...form,title:v})} placeholder="Milk + groceries" />
          <Field label="Amount" value={form.amount} onChange={v=>setForm({...form,amount:v})} placeholder="1500" />
          <Select label="Category" value={form.category} onChange={v=>setForm({...form,category:v})} options={['Groceries','Electricity','Water','Internet','Gas','Repair','Rent','Other'].map(x=>[x,x])}/>
        </div>
        <div className="row">
          <Button variant="primary" onClick={saveExpense} disabled={saving}>{saving ? (editingId?'Saving…':'Adding…') : (editingId?'Save changes':'Add expense')}</Button>
          {!editingId && <span className="role-note">{isAdmin ? 'Creator controls: add · edit · delete' : 'Member controls: add only'}</span>}
        </div>
        <div className="month-note">🔒 Previous months cannot receive new entries. On the first day of a new month, the previous month is archived automatically.</div>
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Current month</h3>
            <p className="muted">{monthLabel(currentMonth)} · {money(total)} total</p>
          </div>
        </div>
        {data.expenses.map((e, idx) => <div className="expense-row" key={e.id || `expense-${currentMonth}-${e.title || 'item'}-${e.date || idx}-${idx}`}>
          <div className="expense-main">
            <div className="row-icon">₹</div>
            <div>
              <strong>{e.title}</strong>
              <small>{memberName(data.members,e.paidByMemberId)} · {fmtDate(e.date)} · {e.category}</small>
            </div>
          </div>
          <div className="expense-end">
            <strong>{money(e.amount)}</strong>
            {isAdmin && <div className="expense-actions"><Button variant="ghost" onClick={()=>beginEdit(e)}>Edit</Button><Button variant="danger" onClick={()=>deleteExpense(e)}>Delete</Button></div>}
          </div>
        </div>)}
        {!data.expenses.length && <Empty text={`No expenses in ${monthLabel(currentMonth)} yet.`}/>} 
      </Card>
    </div>

    <Card>
      <div className="card-head">
        <div>
          <h3>📚 Monthly archive</h3>
          <p className="muted">Completed months are stored separately and never mixed with the active month's balance.</p>
        </div>
      </div>
      {archives.length ? <div className="archive-list">
        {archives.map(a => <div className="archive-card" key={a.id || a.monthKey}>
          <div>
            <strong>{monthLabel(a.monthKey)}</strong>
            <small>{Number(a.entryCount||0)} entries · Archived {a.closedAt ? new Date(a.closedAt).toLocaleDateString('en-IN') : '—'}</small>
          </div>
          <div className="archive-total">{money(a.totalAmount)}</div>
        </div>)}
      </div> : <Empty text="No completed months archived yet. The first previous month will appear here automatically."/>}
    </Card>
  </div>;
}

function Groceries({data,call,notify,reload}) { const [name,setName]=useState(''); const [qty,setQty]=useState('1'); const open=data.groceries.filter(g=>g.status==='open'); return <div className="stack-lg"><SectionTitle eyebrow="KITCHEN" title="Grocery Manager" subtitle="Keep one live shopping list for the house."/><div className="grid-2"><Card><h3>Add item</h3><div className="form-grid"><Field label="Item" value={name} onChange={setName} placeholder="Rice, eggs, oil…"/><Field label="Quantity" value={qty} onChange={setQty} placeholder="2 kg"/></div><Button variant="primary" onClick={async()=>{try{await call('/groceries',{method:'POST',body:JSON.stringify({name,quantity:qty})});setName('');setQty('1');notify('Added to grocery list');reload();}catch(e){notify(e.message,'error')}}}>Add to list</Button></Card><Card><div className="card-head"><div><h3>Shopping list</h3><p className="muted">{open.length} open item{open.length===1?'':'s'}</p></div></div>{data.groceries.map(g=><div className="list-item" key={g.id}><div><strong className={g.status==='bought'?'strike':''}>{g.name}</strong><small>{g.quantity} · {g.category}</small></div><Button variant={g.status==='open'?'success':'ghost'} onClick={async()=>{try{await call(`/groceries/${g.id}`,{method:'PATCH',body:JSON.stringify({status:g.status==='open'?'bought':'open'})});reload();}catch(e){notify(e.message,'error')}}}>{g.status==='open'?'Mark bought':'Reopen'}</Button></div>)}{!data.groceries.length&&<Empty text="Nothing on the shopping list."/>}</Card></div></div>; }

function Meals({data,call,notify,reload,isAdmin}) { const [form,setForm]=useState({date:new Date().toISOString().slice(0,10),mealType:'Dinner',menu:''}); return <div className="stack-lg"><SectionTitle eyebrow="FOOD" title="Meal Planner" subtitle="Shared meal plan; Admin publishes, everyone can view."/><div className="grid-2">{isAdmin?<Card><h3>Add / update meal</h3><div className="form-grid"><Field label="Date" type="date" value={form.date} onChange={v=>setForm({...form,date:v})}/><Select label="Meal" value={form.mealType} onChange={v=>setForm({...form,mealType:v})} options={['Breakfast','Lunch','Dinner'].map(x=>[x,x])}/><Field label="Menu" value={form.menu} onChange={v=>setForm({...form,menu:v})} placeholder="Rice + dal + vegetables"/></div><Button variant="primary" onClick={async()=>{try{await call('/meals',{method:'POST',body:JSON.stringify(form)});notify('Meal saved');setForm(f=>({...f,menu:''}));reload();}catch(e){notify(e.message,'error')}}}>Save meal</Button></Card>:<Card className="notice"><div className="notice-icon">🍲</div><div><strong>Meal plan is shared</strong><p>Ask the Admin to add or update meals. Everyone can see the published plan here.</p></div></Card>}<Card><h3>Upcoming meals</h3>{data.meals.slice(0,14).map((m,idx)=><Row key={m.id || `meal-${m.date || idx}-${m.mealType || 'meal'}-${idx}`} icon="🍲" title={`${m.mealType}: ${m.menu}`} meta={fmtDate(m.date)} />)}{!data.meals.length&&<Empty text="No meals planned yet."/>}</Card></div></div>; }
function Attendance({data,call,notify,reload,isAdmin}) { const [form,setForm]=useState({start:new Date().toISOString().slice(0,10),end:new Date().toISOString().slice(0,10),reason:'Going home'}); return <div className="stack-lg"><SectionTitle eyebrow="AVAILABILITY" title="Availability & Leave" subtitle="Members can request leave; approved leave becomes a hard scheduling constraint."/><div className="grid-2"><Card><h3>Member availability</h3>{data.members.map(m=><div className="availability-row" key={m.id}><div><strong>{m.name}</strong><small>{m.phone || 'No mobile saved'}</small></div><div className="availability-pills"><span className={m.availability?.morning?'ok':''}>AM</span><span className={m.availability?.afternoon?'ok':''}>PM</span><span className={m.availability?.evening?'ok':''}>EV</span></div></div>)}</Card><Card><h3>Request leave</h3><p className="muted">Creates a request for your authenticated account.</p><div className="form-grid"><Field label="Start" type="date" value={form.start} onChange={v=>setForm({...form,start:v})}/><Field label="End" type="date" value={form.end} onChange={v=>setForm({...form,end:v})}/><Field label="Reason" value={form.reason} onChange={v=>setForm({...form,reason:v})}/></div><Button variant="primary" onClick={async()=>{try{await call('/leave',{method:'POST',body:JSON.stringify(form)});notify('Leave request submitted');reload();}catch(e){notify(e.message,'error')}}}>Submit leave</Button><div className="divider"/><h3>{isAdmin?'Leave requests':'My leave requests'}</h3>{data.leaveRequests.map(l=><div className="list-item" key={l.id}><div><strong>{memberName(data.members,l.memberId)}</strong><small>{l.start} → {l.end} · {l.reason}</small></div><div className="row">{isAdmin&&l.status==='pending'?<><Button variant="success" onClick={async()=>{try{await call(`/leave/${l.id}`,{method:'PATCH',body:JSON.stringify({status:'approved'})});notify('Leave approved');reload();}catch(e){notify(e.message,'error')}}}>Approve</Button><Button variant="danger" onClick={async()=>{try{await call(`/leave/${l.id}`,{method:'PATCH',body:JSON.stringify({status:'rejected'})});notify('Leave rejected');reload();}catch(e){notify(e.message,'error')}}}>Reject</Button></>:<span className={`status ${l.status}`}>{l.status}</span>}</div></div>)}{!data.leaveRequests.length&&<Empty text="No leave requests."/>}</Card></div></div>; }
function Announcements({data,call,notify,reload,isAdmin}) { const [title,setTitle]=useState(''); const [message,setMessage]=useState(''); return <div className="stack-lg"><SectionTitle eyebrow="COMMUNICATION" title="House Board" subtitle="Everyone can read announcements. Admin publishes."/>{isAdmin&&<div className="grid-2"><Card><h3>New announcement</h3><Field label="Title" value={title} onChange={setTitle} placeholder="Electricity maintenance"/><label className="field"><span>Message</span><textarea value={message} onChange={e=>setMessage(e.target.value)} rows="5" placeholder="Tomorrow 10 AM – 1 PM…"/></label><Button variant="primary" onClick={async()=>{try{await call('/announcements',{method:'POST',body:JSON.stringify({title,message})});setTitle('');setMessage('');notify('Announcement posted');reload();}catch(e){notify(e.message,'error')}}}>Publish announcement</Button></Card><Card><h3>Delivery</h3><p className="muted">Publishing creates in-app notifications for every member and queues WhatsApp delivery when configured.</p></Card></div>}<Card><h3>Recent announcements</h3>{data.announcements.map(a=><div className="announcement" key={a.id}><strong>{a.title}</strong><p>{a.message}</p><small>{new Date(a.createdAt).toLocaleString('en-IN')}</small></div>)}{!data.announcements.length&&<Empty text="No announcements yet."/>}</Card></div>; }
function Maintenance({data,call,notify,reload,isAdmin}) { const [form,setForm]=useState({title:'',description:'',priority:'normal'}); return <div className="stack-lg"><SectionTitle eyebrow="HOUSECARE" title="Maintenance" subtitle="Everyone can report issues; Admin controls repair status."/><div className="grid-2"><Card><h3>Report issue</h3><Field label="Issue" value={form.title} onChange={v=>setForm({...form,title:v})} placeholder="Kitchen tap leaking"/><label className="field"><span>Description</span><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows="4"/></label><Select label="Priority" value={form.priority} onChange={v=>setForm({...form,priority:v})} options={['low','normal','high','urgent'].map(x=>[x,x.toUpperCase()])}/><Button variant="primary" onClick={async()=>{try{await call('/maintenance',{method:'POST',body:JSON.stringify(form)});setForm({title:'',description:'',priority:'normal'});notify('Maintenance issue reported');reload();}catch(e){notify(e.message,'error')}}}>Report issue</Button></Card><Card><h3>Open & recent issues</h3>{data.maintenance.map(m=><div className="list-item" key={m.id}><div><strong>{m.title}</strong><small>{m.description} · {memberName(data.members,m.reportedByMemberId)}</small></div>{isAdmin?<Select value={m.status} onChange={async v=>{try{await call(`/maintenance/${m.id}`,{method:'PATCH',body:JSON.stringify({status:v})});reload();}catch(e){notify(e.message,'error')}}} options={['open','in_progress','fixed'].map(x=>[x,x])}/>:<span className={`status ${m.status==='fixed'?'done':'pending'}`}>{m.status}</span>}</div>)}{!data.maintenance.length&&<Empty text="No maintenance issues."/>}</Card></div></div>; }
function Inventory({data,call,notify,reload,isAdmin}) { const [form,setForm]=useState({name:'',category:'Appliance',condition:'Good',warrantyUntil:'',notes:''}); return <div className="stack-lg"><SectionTitle eyebrow="ASSETS" title="House Inventory" subtitle="Shared assets are visible to everyone. Admin maintains the official inventory."/><div className="grid-2">{isAdmin?<Card><h3>Add asset</h3>{[['name','Name'],['category','Category'],['condition','Condition'],['warrantyUntil','Warranty until'],['notes','Notes']].map(([k,l])=><Field key={k} label={l} type={k==='warrantyUntil'?'date':'text'} value={form[k]} onChange={v=>setForm({...form,[k]:v})}/>) }<Button variant="primary" onClick={async()=>{try{await call('/inventory',{method:'POST',body:JSON.stringify(form)});setForm({name:'',category:'Appliance',condition:'Good',warrantyUntil:'',notes:''});notify('Asset added');reload();}catch(e){notify(e.message,'error')}}}>Add asset</Button></Card>:<Card className="notice"><div className="notice-icon">📦</div><div><strong>Shared house inventory</strong><p>Only Admin can add or edit official household assets.</p></div></Card>}<Card><h3>Shared assets</h3>{data.inventory.map(i=><div className="asset" key={i.id}><div className="asset-icon">📦</div><div><strong>{i.name}</strong><small>{i.category} · {i.condition}{i.warrantyUntil?` · Warranty ${fmtDate(i.warrantyUntil)}`:''}</small>{i.notes&&<p>{i.notes}</p>}</div></div>)}{!data.inventory.length&&<Empty text="No inventory records."/>}</Card></div></div>; }
function Fairness({data}) { const stats=data.analytics?.stats||[]; const max=Math.max(1,...stats.map(x=>Number(x.effort||0))); return <div className="stack-lg"><SectionTitle eyebrow="FAIRNESS" title="Workload Analytics" subtitle="Everyone can see transparent workload metrics for this house."/><div className="grid-2">{stats.map(x=><Card key={x.member.id}><div className="card-head"><div><h3>{x.member.name}</h3><p className="muted">{x.completed} completed · {x.tasks} assignments</p></div><strong className="big-number">{x.effort}</strong></div><div className="bar"><span style={{width:`${Math.min(100,(x.effort/max)*100)}%`}}/></div></Card>)}</div>{!stats.length&&<Empty text="No workload history yet."/>}</div>; }
function Messages({data,call,notify,reload}) { return <div className="stack-lg"><SectionTitle eyebrow="MESSAGING" title="WhatsApp & Notifications" subtitle="Delivery is routed from each member's stored mobile number. Failed sends remain visible instead of being hidden."/><Card><div className="metric-grid mini"><Metric label="Sent today" value={data.automation?.messageSummary?.sent||0} hint="Daily messages" icon="✓"/><Metric label="Failed today" value={data.automation?.messageSummary?.failed||0} hint="Needs attention" icon="!" tone={data.automation?.messageSummary?.failed?'warn':''}/><Metric label="WhatsApp" value={data.automation?.whatsappConfigured?'READY':'NOT READY'} hint="Twilio configuration" icon="✉"/><Metric label="Daily time" value={data.automation?.dailyTime||'06:00'} hint={data.automation?.timezone||'Asia/Kolkata'} icon="◷"/></div></Card><Card><div className="card-head"><div><h3>Recent delivery log</h3></div></div>{(data.messages||[]).map((m,i)=><div className="message-log" key={m.id||i}><span className={`delivery-dot ${m.success?'ok':'bad'}`}></span><div><strong>{memberName(data.members,m.memberId)} · {m.type}</strong><small>{m.phone || 'No phone'} · {new Date(m.createdAt).toLocaleString('en-IN')}</small></div><div className="message-status">{m.success?'Sent':'Failed'}{m.reason&&<small>{m.reason}</small>}</div></div>)}{!((data.messages)||[]).length&&<Empty text="Message logs are shown after the first automation/test send."/>}</Card></div>; }

function Security({data,user,call,notify,reload,enablePush}) {
  const [devices,setDevices] = useState([]);
  const [loading,setLoading] = useState(false);
  const [revoking,setRevoking] = useState(false);
  const [events,setEvents] = useState([]);
  const security = data.security;

  const loadDevices = async () => {
    try { const r = await call('/notifications/devices'); setDevices(r.devices || []); } catch (e) { notify(e.message,'error'); }
  };

  useEffect(() => { loadDevices(); }, [user?.id]);

  const revoke = async () => {
    setRevoking(true);
    try {
      await call('/security/revoke-sessions',{method:'POST'});
      notify('All sessions and push devices revoked. Please log in again.','warning');
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.reload();
    } catch (e) { notify(e.message,'error'); }
    finally { setRevoking(false); }
  };

  const pushReady = security?.notifications?.fcm?.configured;
  const pushPermission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const protection = security?.protection || {};

  return <div className="stack-lg">
    <SectionTitle eyebrow="SECURITY" title="My Security" subtitle="Only the house creator can open this page. It shows your account, your devices and security activity for your current house only."/>

    <div className="metric-grid">
      <Metric label="Email" value={security?.account?.emailVerified?'VERIFIED':'NOT VERIFIED'} hint={security?.account?.emailVerified?'Identity email confirmed':'Verify your email in My Profile'} icon="✉" tone={security?.account?.emailVerified?'':'warn'}/>
      <Metric label="Mobile" value={security?.account?.phoneConfigured?'READY':'MISSING'} hint="Used for house messaging" icon="📱" tone={security?.account?.phoneConfigured?'':'warn'}/>
      <Metric label="Database" value={protection.database?.toUpperCase() || 'UNKNOWN'} hint="MongoDB connection status" icon="◉" tone={protection.database==='connected'?'':'warn'}/>
      <Metric label="Push" value={pushReady?'READY':'OPTIONAL'} hint={pushReady?`${devices.length} registered device${devices.length===1?'':'s'}`:'Configure Firebase FCM'} icon="🔔" tone={pushReady?'':'warn'}/>
    </div>

    <div className="grid-2">
      <Card>
        <div className="card-head"><div><h3>Protection layers</h3><p className="muted">Server-side controls are applied to every authenticated request.</p></div><span className="status done">ACTIVE</span></div>
        <div className="security-list">
          <SecurityRow label="HTTP security headers" value={protection.helmet}/>
          <SecurityRow label="CORS origin allowlist" value={protection.corsAllowlist}/>
          <SecurityRow label="Compression" value={protection.compression}/>
          <SecurityRow label="Request body limit" value={protection.bodyLimit || '1mb'}/>
          <SecurityRow label="API rate limiting" value={protection.apiRateLimit}/>
          <SecurityRow label="Login rate limiting" value={protection.authRateLimit}/>
          <SecurityRow label="Password hashing" value={`bcrypt · ${protection.bcryptRounds || 12} rounds`}/>
          <SecurityRow label="Tenant isolation" value={protection.tenantIsolation}/>
          <SecurityRow label="Request IDs" value={protection.requestId}/>
        </div>
      </Card>

      <Card>
        <div className="card-head"><div><h3>Push notifications</h3><p className="muted">FCM is the primary free notification channel. WhatsApp remains optional.</p></div></div>
        <div className="automation-card"><div><strong>Firebase Cloud Messaging</strong><p>{pushReady?'Backend push service is configured.':'Firebase web push is not configured yet.'}</p></div><span className={`status ${pushReady?'done':'pending'}`}>{pushReady?'READY':'SETUP'}</span></div>
        <div className="automation-card"><div><strong>Browser permission</strong><p>Current permission: {pushPermission}</p></div><span className={`status ${pushPermission==='granted'?'done':'pending'}`}>{pushPermission.toUpperCase()}</span></div>
        <div className="row" style={{marginTop:12}}>
          <Button variant="primary" onClick={async()=>{setLoading(true);try{await enablePush();await loadDevices();}finally{setLoading(false);}}} disabled={loading || !pushReady}>{loading?'Enabling…':pushPermission==='granted'?'Register this device':'Enable push notifications'}</Button>
          <Button onClick={loadDevices}>Refresh devices</Button>
        </div>
        {!pushReady && <div className="month-note">Add your Firebase web app keys to the frontend environment and FCM service-account credentials to the backend before enabling push.</div>}
      </Card>
    </div>

    <Card>
      <div className="card-head"><div><h3>Registered devices</h3><p className="muted">Only your own devices are listed here.</p></div></div>
      {devices.length ? devices.map(d=><div className="security-device" key={d.id}><div><strong>{d.platform.toUpperCase()} device</strong><small>{d.tokenPreview} · Last seen {d.lastSeenAt?new Date(d.lastSeenAt).toLocaleString('en-IN'):'—'}</small></div><span className="status done">ACTIVE</span></div>) : <Empty text="No push devices registered for this account."/>}
      <div className="divider"/>
      <div className="row" style={{justifyContent:'space-between'}}><div><strong>Revoke all sessions</strong><p className="muted">Invalidates existing JWT sessions and registered push devices for this account.</p></div><Button variant="danger" disabled={revoking} onClick={revoke}>{revoking?'Revoking…':'Revoke all sessions'}</Button></div>
    </Card>

    <Card>
      <div className="card-head"><div><h3>My recent security activity</h3><p className="muted">Only actions belonging to your account are shown.</p></div><Button onClick={async()=>{try{const r=await call('/security/events'); setEvents(r.events||[]); notify(`${(r.events||[]).length} personal events loaded`,'info');}catch(e){notify(e.message,'error')}}}>Refresh activity</Button></div>
      {events.length ? events.slice(0,20).map((e,i)=><div className="security-event" key={e._id||`event-${i}`}><div><strong>{e.action}</strong><small>{e.ip || 'IP unavailable'} · {e.createdAt?new Date(e.createdAt).toLocaleString('en-IN'):'—'}</small></div><span>MY ACCOUNT</span></div>) : <Empty text="Refresh activity to load recent security events for your account."/>}
    </Card>
  </div>;
}
function SecurityRow({label,value}){ const ok = typeof value === 'boolean' ? value : true; return <div className="security-row"><span>{label}</span><strong className={ok===false?'danger-text':'success-text'}>{typeof value === 'boolean' ? (value?'ACTIVE':'NOT ACTIVE') : value}</strong></div>; }

function Members({data,call,notify,reload}) { return <div className="stack-lg"><SectionTitle eyebrow="PEOPLE" title={`House Members · ${data.members.length}/${data.house?.capacity || 5}`} subtitle="Real accounts only. The saved mobile number is used for direct house messaging." right={<InviteBlock code={data.house?.inviteCode} url={data.house?.inviteCode?`${window.location.origin}/?invite=${encodeURIComponent(data.house.inviteCode)}`:''} notify={notify}/>} /><div className="member-grid">{data.members.map(m=><MemberCard key={m.id} member={m} isAdmin={m.role==='ADMIN'} call={call} notify={notify} reload={reload}/>)}</div>{data.members.length<(data.house?.capacity || 5)&&<Card className="notice"><div className="notice-icon">➕</div><div><strong>Waiting for {(data.house?.capacity || 5)-data.members.length} roommate{(data.house?.capacity || 5)-data.members.length===1?'':'s'}.</strong><p>Share the invite code. Each person registers their own account and phone number.</p></div></Card>}</div>; }
function InviteBlock({code,url,notify}) { return <div className="invite-inline"><small>INVITE CODE</small><strong>{code||'—'}</strong><Button onClick={()=>{navigator.clipboard?.writeText(url||code||'');notify('Invite link copied');}}>Copy</Button></div>; }
function MemberCard({member,isAdmin,call,notify,reload}) {
  const [phone,setPhone]=useState(member.phone||'');
  const [saving,setSaving]=useState(false);
  const savePhone = async () => {
    try {
      setSaving(true);
      await call(`/members/${member.id}`,{method:'PATCH',body:JSON.stringify({phone})});
      notify(`${member.name}'s number saved`);
      reload();
    } catch(e) { notify(e.message,'error'); } finally { setSaving(false); }
  };
  const sendSms = () => {
    const raw = String(phone || member.phone || '').trim();
    const digits = raw.replace(/\D/g,'');
    if (!digits) { notify(`${member.name} has no mobile number yet.`,'error'); return; }
    const destination = raw.startsWith('+') ? raw.replace(/[^+\d]/g,'') : `+${digits}`;
    const message = encodeURIComponent(`Hi ${member.name}, this is Bachelor House Manager. Your house notification is ready.`);
    window.location.href = `sms:${destination}?body=${message}`;
  };
  return <Card className="member-card"><div className="member-top"><div className="avatar large" style={member.avatar?{backgroundImage:`url(${member.avatar})`}:undefined}>{!member.avatar&&(member.name||'?').slice(0,1).toUpperCase()}</div><div><h3>{member.name}</h3><span className={`tag ${isAdmin?'gold':''}`}>{isAdmin?'ADMIN':'MEMBER'}</span></div></div><div className="member-info"><div><small>Mobile number</small><strong>{member.phone||'Not connected'}</strong></div><div><small>Availability</small><strong>{['morning','afternoon','evening'].filter(k=>member.availability?.[k]).map(k=>k[0].toUpperCase()+k.slice(1)).join(' · ')||'Limited'}</strong></div></div><Field label="Phone" value={phone} onChange={setPhone} placeholder="+919876543210"/><div className="row"><Button onClick={savePhone} disabled={saving}>{saving?'Saving…':'Save number'}</Button><Button variant="primary" disabled={!phone||saving} onClick={sendSms}>Send SMS</Button></div><div className="member-action-note">Uses the member's saved number and opens the phone's SMS composer with a ready message.</div></Card>; }

function Settings({data,call,notify,reload}) { const [name,setName]=useState(data.house?.name||''); const [max,setMax]=useState(data.house?.maxTasksPerDay||4); return <div className="stack-lg"><SectionTitle eyebrow="ADMIN" title="House Settings" subtitle="Only the house Admin can change system configuration."/><div className="grid-2"><Card><h3>House configuration</h3><Field label="House name" value={name} onChange={setName}/><Select label="Max chores/member/day" value={String(max)} onChange={v=>setMax(Number(v))} options={['3','4','5'].map(x=>[x,x])}/><Button variant="primary" onClick={async()=>{try{await call('/house',{method:'PATCH',body:JSON.stringify({name,maxTasksPerDay:max})});notify('House settings saved');reload();}catch(e){notify(e.message,'error')}}}>Save settings</Button></Card><Card><h3>Automation</h3><div className="automation-card"><div><strong>Daily 7-day generator</strong><p>Server time zone: {data.automation?.timezone||'Asia/Kolkata'}</p></div><span className="status done">{data.automation?.dailyTime||'06:00'}</span></div><div className="automation-card"><div><strong>WhatsApp routing</strong><p>Uses each member profile's mobile number.</p></div><span className={`status ${data.automation?.whatsappConfigured?'done':'pending'}`}>{data.automation?.whatsappConfigured?'READY':'CONFIGURE'}</span></div></Card></div><Card><h3>House invite</h3><div className="invite-box"><div><small>Share this code with new roommates</small><strong>{data.house?.inviteCode}</strong></div><Button onClick={()=>{navigator.clipboard?.writeText(data.house?.inviteCode||'');notify('Invite code copied');}}>Copy Code</Button></div></Card></div>; }

function CropPhotoModal({source,onClose,onUse,notify}) {
  const STAGE = 280;
  const [zoom,setZoom] = useState(1);
  const [position,setPosition] = useState({x:0,y:0});
  const [drag,setDrag] = useState(null);
  const [busy,setBusy] = useState(false);

  const fit = Math.max(STAGE / source.width, STAGE / source.height);
  const scaledWidth = source.width * fit * zoom;
  const scaledHeight = source.height * fit * zoom;
  const left = (STAGE - scaledWidth) / 2 + position.x;
  const top = (STAGE - scaledHeight) / 2 + position.y;

  const clampPosition = (x,y,z=zoom) => {
    const w = source.width * fit * z;
    const h = source.height * fit * z;
    const maxX = Math.max(0,(w-STAGE)/2);
    const maxY = Math.max(0,(h-STAGE)/2);
    return {x:Math.min(maxX,Math.max(-maxX,x)),y:Math.min(maxY,Math.max(-maxY,y))};
  };

  const onPointerDown = e => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({startX:e.clientX,startY:e.clientY,originX:position.x,originY:position.y});
  };
  const onPointerMove = e => {
    if (!drag) return;
    setPosition(clampPosition(drag.originX + e.clientX - drag.startX, drag.originY + e.clientY - drag.startY));
  };
  const onPointerUp = () => setDrag(null);

  const apply = async () => {
    setBusy(true);
    try {
      const img = new Image();
      img.src = source.src;
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;});
      let output = '';
      for (const size of [360,320,280]) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d',{alpha:false});
        if (!ctx) throw new Error('Image processing is not available in this browser.');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,size,size);
        const scaleFactor = size / STAGE;
        ctx.drawImage(img,left*scaleFactor,top*scaleFactor,scaledWidth*scaleFactor,scaledHeight*scaleFactor);
        output = canvas.toDataURL('image/jpeg',0.82);
        if (output.length <= 220000) break;
      }
      if (output.length > 240000) throw new Error('Cropped photo is still too large. Reduce zoom or choose another photo.');
      await onUse(output);
    } catch (e) {
      notify(e.message || 'Could not prepare the cropped photo.','error');
    } finally { setBusy(false); }
  };

  return <div className="modal-backdrop">
    <div className="modal-card crop-modal">
      <div className="modal-header">
        <div><div className="eyebrow">PHOTO EDITOR</div><h2>Crop profile photo</h2><p className="muted">Drag the photo, then adjust zoom. The square area is what will be saved.</p></div>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="crop-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <img src={source.src} alt="Crop preview" className="crop-image" style={{width:scaledWidth,height:scaledHeight,left,top}} draggable="false" />
        <div className="crop-grid" aria-hidden="true"><span/><span/><span/><span/></div>
      </div>
      <div className="crop-controls">
        <span className="muted">Zoom</span>
        <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={e=>{const z=Number(e.target.value);setZoom(z);setPosition(p=>clampPosition(p.x,p.y,z));}} />
        <span className="zoom-label">{zoom.toFixed(2)}×</span>
      </div>
      <div className="row crop-actions"><Button onClick={()=>{setZoom(1);setPosition({x:0,y:0});}}>Reset crop</Button><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={apply}>{busy?'Saving…':'Use this photo'}</Button></div>
    </div>
  </div>;
}

function Profile({data,user,call,notify,reload}) {
  const [selectedId, setSelectedId] = useState(user.memberId);
  const [passwords, setPasswords] = useState({current:'', next:'', confirm:''});
  const [cropEditor, setCropEditor] = useState(null);

  const selected = data.profiles.find(p => p.id === selectedId)
    || data.members.find(m => m.id === selectedId)
    || data.members[0];
  const isMine = selected?.userId === user.id || selected?.id === user.memberId;

  const [form, setForm] = useState({
    name: selected?.name || user.name || '', phone: selected?.phone || user.phone || '', email: selected?.email || user.email || '', avatar: selected?.avatar || user.avatar || '',
    preferred: (selected?.preferred || []).join(', '), avoided: (selected?.avoided || []).join(', '),
    morning: selected?.availability?.morning ?? true, afternoon: selected?.availability?.afternoon ?? true, evening: selected?.availability?.evening ?? true
  });

  useEffect(() => {
    if (!selected) return;
    setForm({name:selected.name||'',phone:selected.phone||'',email:selected.email||'',avatar:selected.avatar||'',preferred:(selected.preferred||[]).join(', '),avoided:(selected.avoided||[]).join(', '),morning:selected.availability?.morning??true,afternoon:selected.availability?.afternoon??true,evening:selected.availability?.evening??true});
    setPasswords({current:'',next:'',confirm:''});
    setCropEditor(null);
  }, [selectedId, data.profiles]);

  const save = async () => {
    if (!isMine) return;
    try {
      const r = await call('/profile',{method:'PATCH',body:JSON.stringify({
        name:form.name, phone:form.phone, email:form.email, avatar:form.avatar,
        preferred:form.preferred.split(',').map(x=>x.trim()).filter(Boolean), avoided:form.avoided.split(',').map(x=>x.trim()).filter(Boolean),
        availability:{morning:form.morning,afternoon:form.afternoon,evening:form.evening}
      })});
      notify(r.verification?.sent?'Profile saved. Verification email sent.':r.verification?.previewUrl?'Profile saved. Verification link generated.':'Profile saved.');
      await reload();
    } catch(e) { notify(e.message,'error'); }
  };

  const pickPhoto = e => {
    if (!isMine) return;
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) { notify('Please choose an image file.','error'); return; }
    if (file.size > 8*1024*1024) { notify('Choose an image smaller than 8 MB.','error'); return; }
    const reader = new FileReader();
    reader.onerror = () => notify('Could not read that image.','error');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => notify('Could not decode that image.','error');
      img.onload = () => setCropEditor({src:reader.result,width:img.width,height:img.height});
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const saveCroppedPhoto = async dataUrl => {
    const saved = await call('/profile',{method:'PATCH',body:JSON.stringify({avatar:dataUrl})});
    setForm(f=>({...f,avatar:saved.profile?.avatar||dataUrl}));
    setCropEditor(null);
    notify('Profile photo cropped and saved ✅');
    await reload();
  };

  const resendVerification = async () => { try { const r=await call('/profile/resend-verification',{method:'POST'}); notify(r.sent?'Verification email sent.':r.previewUrl?'Verification link generated in development.':r.reason||'Verification request complete.',r.sent||r.previewUrl?'success':'warning'); } catch(e){notify(e.message,'error');} };

  if (!selected) return <Empty text="Profile unavailable."/>;

  return <div className="stack-lg">
    <SectionTitle eyebrow="PEOPLE & PROFILE" title={isMine?'My Profile':`${selected.name}'s Profile`} subtitle={isMine?'Update your personal details, mobile, photo, email and house preferences.':'House members can view each other’s profile details. Only the account owner can edit their profile.'} right={<Select label="" value={selectedId} onChange={setSelectedId} options={data.profiles.map(p=>[p.id,p.name])}/>}/>
    <div className="grid-2">
      <Card>
        <div className="profile-hero">
          <div className="avatar profile-avatar" style={form.avatar?{backgroundImage:`url(${form.avatar})`}:undefined}>{!form.avatar&&(selected.name||'U').slice(0,1).toUpperCase()}</div>
          <div><h3>{selected.name}</h3><span className={`tag ${selected.role==='ADMIN'?'gold':''}`}>{selected.role}</span><p className="muted">Joined {selected.joinedAt?new Date(selected.joinedAt).toLocaleDateString('en-IN'):'—'}</p></div>
        </div>
        {isMine ? <>
          <Field label="Profile name" value={form.name} onChange={v=>setForm({...form,name:v})}/>
          <Field label="Mobile / WhatsApp" value={form.phone} onChange={v=>setForm({...form,phone:v})} placeholder="+919876543210"/>
          <Field label="Email" value={form.email} onChange={v=>setForm({...form,email:v})} placeholder="you@example.com"/>
          <div className="verify-row"><span className={`status ${selected.emailVerified?'done':'pending'}`}>{selected.emailVerified?'EMAIL VERIFIED':'EMAIL NOT VERIFIED'}</span><Button onClick={resendVerification}>Send verification</Button></div>
          <label className="field"><span>Profile photo</span><input type="file" accept="image/*" onChange={pickPhoto}/><small className="field-help">Choose a photo → crop and position it → save.</small></label>
          <div className="form-grid"><Field label="Preferred chores" value={form.preferred} onChange={v=>setForm({...form,preferred:v})} placeholder="Cooking, Water"/><Field label="Avoided chores" value={form.avoided} onChange={v=>setForm({...form,avoided:v})} placeholder="Dish Washing"/></div>
          <div className="availability-checks"><label><input type="checkbox" checked={form.morning} onChange={e=>setForm({...form,morning:e.target.checked})}/> Morning</label><label><input type="checkbox" checked={form.afternoon} onChange={e=>setForm({...form,afternoon:e.target.checked})}/> Afternoon</label><label><input type="checkbox" checked={form.evening} onChange={e=>setForm({...form,evening:e.target.checked})}/> Evening</label></div>
          <Button variant="primary" onClick={save}>Save profile</Button>
        </> : <div className="profile-read"><Row icon="📱" title="Mobile / WhatsApp" meta="Used for personalized house notifications" value={selected.phone||'Not connected'}/><Row icon="✉" title="Email" meta={selected.emailVerified?'Verified':'Not verified'} value={selected.email||'Not provided'}/><Row icon="👤" title="Account role" meta="House access" value={selected.role}/><Row icon="◷" title="Availability" meta="Current schedule windows" value={['morning','afternoon','evening'].filter(k=>selected.availability?.[k]).join(' · ')||'Limited'}/><Row icon="⚖" title="Preferences" meta="FairChore Engine inputs" value={(selected.preferred||[]).join(', ')||'No preferences set'}/></div>}
        {isMine && <><div className="divider"/><PasswordChange call={call} notify={notify} passwords={passwords} setPasswords={setPasswords}/></>}
      </Card>
      <Card>
        <h3>House profiles</h3><p className="muted">Everyone in your house can open these profiles.</p>
        <div className="profile-list">{data.profiles.map(p=><button key={p.id} className={`profile-list-item ${p.id===selectedId?'selected':''}`} onClick={()=>setSelectedId(p.id)}><div className="avatar" style={p.avatar?{backgroundImage:`url(${p.avatar})`}:undefined}>{!p.avatar&&(p.name||'U').slice(0,1).toUpperCase()}</div><div><strong>{p.name}</strong><small>{p.role} · {p.phone||'No mobile'}</small></div><span>›</span></button>)}</div>
      </Card>
    </div>
    {isMine && cropEditor && <CropPhotoModal source={cropEditor} onClose={()=>setCropEditor(null)} onUse={saveCroppedPhoto} notify={notify}/>} 
  </div>;
}

function PasswordChange({call,notify,passwords,setPasswords}){ return <div className="password-panel"><div className="card-head"><div><h3>Change password</h3><p className="muted">Use your current password to set a new one.</p></div></div><Field label="Current password" type="password" value={passwords.current} onChange={v=>setPasswords(p=>({...p,current:v}))}/><Field label="New password" type="password" value={passwords.next} onChange={v=>setPasswords(p=>({...p,next:v}))}/><Field label="Confirm new password" type="password" value={passwords.confirm} onChange={v=>setPasswords(p=>({...p,confirm:v}))}/><Button variant="primary" onClick={async()=>{if(passwords.next!==passwords.confirm){notify('New passwords do not match.','error');return;}try{await call('/profile/change-password',{method:'POST',body:JSON.stringify({currentPassword:passwords.current,newPassword:passwords.next})});setPasswords({current:'',next:'',confirm:''});notify('Password changed successfully.');}catch(e){notify(e.message,'error')}}}>Change password</Button></div>;}

function InviteModal({data,call,notify,onClose}){
  const [busy,setBusy]=useState(false); const [invite,setInvite]=useState(data.house?.inviteCode||''); const [url,setUrl]=useState('');
  useEffect(()=>{(async()=>{try{const r=await call('/invite');setInvite(r.inviteCode||invite);setUrl(r.joinUrl||'');}catch(e){}})();},[]);
  const copy=async(value,msg)=>{try{await navigator.clipboard.writeText(value);notify(msg);}catch{notify(value,'warning')}};
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-header"><div><div className="eyebrow">INVITATION</div><h2>Invite roommates</h2><p className="muted">This link is active. Anyone with it can create a Member account until the house is full.</p></div><button className="modal-close" onClick={onClose}>✕</button></div><div className="invite-hero"><small>HOUSE INVITE CODE</small><strong>{invite||'—'}</strong><span>{data.members.length}/{data.house?.capacity||5} members joined</span></div><div className="invite-url"><span>{url||'Generate link from backend…'}</span><Button onClick={()=>copy(url||invite,'Invitation link copied')}>Copy link</Button></div><div className="row"><Button variant="primary" onClick={()=>copy(invite,'Invite code copied')}>Copy code</Button>{url&&<Button onClick={()=>copy(`https://wa.me/?text=${encodeURIComponent(`Join our house on Bachelor House Manager: ${url}`)}`,'WhatsApp share link copied')}>WhatsApp share</Button>}{navigator.share&&url&&<Button onClick={async()=>{setBusy(true);try{await navigator.share({title:'Join our house',text:`Join ${data.house?.name||'our house'}:`,url});}catch{}finally{setBusy(false);}}} disabled={busy}>Share</Button>}</div><div className="admin-hint"><strong>Security:</strong> joining users become MEMBER accounts. They cannot select or promote themselves to Admin.</div></div></div>;
}

function Empty({text}){return <div className="empty"><div>◌</div><span>{text}</span></div>}
function Row({icon,title,meta,value}){return <div className="row-item"><span className="row-icon">{icon}</span><div><strong>{title}</strong><small>{meta}</small></div>{value&&<strong>{value}</strong>}</div>}
function memberName(members,id){return members.find(m=>m.id===id)?.name||'Unknown';}

export default App;
