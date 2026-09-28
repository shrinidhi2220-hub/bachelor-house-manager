import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { connectDB, mongoose } from './db.js';
import {
  User, House, Member, TaskDefinition, Schedule, Assignment,
  Expense, ExpenseArchive, Grocery, Meal, Announcement, Maintenance, Inventory,
  LeaveRequest, SwapRequest, Notification, AuditLog, MessageJob, MessageLog, DeviceToken, PushJob
} from './models.js';
import { hashPassword, verifyPassword, normalizeUsername, normalizePhone, validPhone, normalizeEmail, validEmail, signToken, publicUser } from './security.js';
import { sendVerificationEmail, emailStatus } from './email.js';
import { BASE_TASKS, addDays, weekStart, dayName, chooseMember } from './schedule-engine.js';
import { whatsappStatus, sendTemplate } from './whatsapp.js';
import { fcmStatus } from './fcm.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = Number(process.env.PORT || 5000);
const TIME_ZONE = process.env.HOUSE_TIME_ZONE || 'Asia/Kolkata';
const DAILY_HOUR = Number(process.env.DAILY_GENERATE_HOUR ?? 6);
const DAILY_MINUTE = Number(process.env.DAILY_GENERATE_MINUTE ?? 0);
const DEFAULT_CAPACITY = Number(process.env.DEFAULT_HOUSE_CAPACITY || 5);
const MAX_CAPACITY = Number(process.env.MAX_HOUSE_CAPACITY || 20);
const DEFAULT_MAX_TASKS = Number(process.env.DEFAULT_MAX_TASKS_PER_DAY || 4);
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'dev-only-change-me';

if (process.env.NODE_ENV === 'production' && TOKEN_SECRET === 'dev-only-change-me') {
  throw new Error('TOKEN_SECRET must be set in production.');
}

function allowedOrigins() {
  const configured = String(process.env.CLIENT_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  const defaults = process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return [...new Set([...defaults, ...configured])];
}
const origins = allowedOrigins();
const isAllowedDevOrigin = origin => {
  if (process.env.NODE_ENV === 'production' || !origin) return false;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.port === '5173';
  } catch {
    return false;
  }
};
app.use(cors({
  origin(origin, cb) {
    if (!origin || origins.includes(origin) || isAllowedDevOrigin(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`Origin not allowed by CORS: ${origin}`));
  }
}));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use((req, res, next) => { const requestId = req.headers['x-request-id'] || crypto.randomUUID(); req.requestId = String(requestId).slice(0, 120); res.setHeader('X-Request-Id', req.requestId); next(); });
app.use(express.json({ limit: '1mb' }));
const apiLimiter = rateLimit({ windowMs: Number(process.env.API_RATE_WINDOW_MS || 60_000), limit: Number(process.env.API_RATE_LIMIT || 1200), standardHeaders: 'draft-8', legacyHeaders: false, skip: req => req.path === '/api/health' || req.path === '/api/ready' });
const authLimiter = rateLimit({ windowMs: Number(process.env.AUTH_RATE_WINDOW_MS || 15 * 60_000), limit: Number(process.env.AUTH_RATE_LIMIT || 15), standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api', apiLimiter);

function id(v) { return v?.toString?.() || String(v); }
function localDateString(now = new Date(), tz = TIME_ZONE) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now).map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
function nowLocalTime(now = new Date(), tz = TIME_ZONE) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(now).map(x=>[x.type,x.value])); return `${p.hour}:${p.minute}`; }
function isToday(date) { return date === localDateString(); }
function monthKey(date) { return String(date || '').slice(0, 7); }
function previousMonthKey(currentMonth) { const [y,m] = String(currentMonth).split('-').map(Number); if (!y || !m) return ''; const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; }
function nextMonthStart(month) { const [y,m] = String(month).split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`; }
async function archiveExpenseMonth(house, month, userId=null) {
  if (!month) return null;
  const existing = await ExpenseArchive.findOne({houseId:house._id, monthKey:month});
  if (existing) return existing;
  const start = `${month}-01`; const next = nextMonthStart(month);
  const expenses = await Expense.find({houseId:house._id, date:{$gte:start,$lt:next}}).lean();
  const members = await Member.find({houseId:house._id}).select('_id name').lean();
  const names = new Map(members.map(m=>[id(m._id),m.name]));
  const categoryTotals = {}; const memberMap = new Map(); let totalAmount = 0;
  for (const e of expenses) {
    const amount = Number(e.amount || 0); totalAmount += amount;
    const cat = e.category || 'Other'; categoryTotals[cat] = (categoryTotals[cat] || 0) + amount;
    const key = id(e.paidByMemberId); const item = memberMap.get(key) || {memberId:key,memberName:names.get(key)||'Former member',amount:0,entries:0};
    item.amount += amount; item.entries += 1; memberMap.set(key,item);
  }
  try {
    return await ExpenseArchive.create({houseId:house._id,monthKey:month,totalAmount,entryCount:expenses.length,categoryTotals,memberTotals:[...memberMap.values()],closedByUserId:userId});
  } catch (e) { if (e?.code===11000) return ExpenseArchive.findOne({houseId:house._id,monthKey:month}); throw e; }
}
async function ensurePreviousExpenseArchive(house) { const current = localDateString(new Date(), house.timezone || TIME_ZONE).slice(0,7); const previous = previousMonthKey(current); if (previous) await archiveExpenseMonth(house,previous,null); }
async function expensePayload(house) {
  const current = localDateString(new Date(), house.timezone || TIME_ZONE).slice(0,7);
  await ensurePreviousExpenseArchive(house);
  const next = nextMonthStart(current);
  const expenses = await Expense.find({houseId:house._id,date:{$gte:`${current}-01`,$lt:next}}).sort({date:-1,createdAt:-1}).limit(200);
  const archives = await ExpenseArchive.find({houseId:house._id}).sort({monthKey:-1}).limit(24);
  const total = expenses.reduce((sum,e)=>sum+Number(e.amount||0),0);
  return {expenses:expenses.map(json),currentMonth:current,currentTotal:total,currentEntryCount:expenses.length,archives:archives.map(json)};
}
function makeInviteCode() { return `BH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function safe(v, max=500) { return String(v ?? '').trim().slice(0,max); }
function json(doc) { if (!doc) return null; const obj = doc.toObject?.() || doc; if (obj._id && obj.id === undefined) obj.id = id(obj._id); return obj; }
function memberPublic(m) { return { id:id(m._id), userId:id(m.userId), houseId:id(m.houseId), name:m.name, phone:m.phone || '', role:m.role, isCreator:!!m.isCreator, avatar:m.avatar || '', capabilities:m.capabilities, availability:m.availability, preferred:m.preferred, avoided:m.avoided, tempAbsent:m.tempAbsent || null, joinedAt:m.joinedAt, active:m.active }; }
function housePublic(h) { return { id:id(h._id), name:h.name, inviteCode:h.inviteCode, ownerUserId:id(h.ownerUserId), timezone:h.timezone, capacity:h.capacity, maxTasksPerDay:h.maxTasksPerDay, morningCookCanCookLunch:h.morningCookCanCookLunch, waterMembersCount:h.waterMembersCount, roomCleaningMembersCount:h.roomCleaningMembersCount, autoReplacement:h.autoReplacement, active:h.active }; }
function assignmentPublic(a) { return { id:id(a._id), houseId:id(a.houseId), scheduleId:id(a.scheduleId), date:a.date, taskId:id(a.taskId), taskKey:a.taskKey, taskName:a.taskName, category:a.category, time:a.time, timeSlot:a.timeSlot, effort:a.effort, icon:a.icon, assignedToMemberId:id(a.assignedToMemberId), status:a.status, completedAt:a.completedAt, completedByUserId:a.completedByUserId ? id(a.completedByUserId) : null, explanation:a.explanation }; }

async function getCurrentContext(req) {
  const user = await User.findById(req.auth.userId);
  if (!user || user.status !== 'active') return null;
  if (!user.currentHouseId || !user.currentMemberId) return { user, house:null, member:null };
  const [house, member] = await Promise.all([House.findOne({ _id:user.currentHouseId, active:true }), Member.findOne({ _id:user.currentMemberId, userId:user._id, houseId:user.currentHouseId, active:true })]);
  return { user, house, member };
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error:'Authentication required.' });
    const jwt = await import('jsonwebtoken');
    let payload;
    try { payload = jwt.default.verify(token, TOKEN_SECRET, { issuer:'bachelor-house-manager' }); }
    catch { return res.status(401).json({ error:'Authentication failed.' }); }
    const sessionUser = await User.findById(payload.sub).select('status tokenVersion');
    if (!sessionUser || sessionUser.status !== 'active' || Number(sessionUser.tokenVersion || 0) !== Number(payload.tv || 0)) return res.status(401).json({ error:'Session expired or revoked. Please log in again.' });
    req.auth = { userId: payload.sub };
    req.ctx = await getCurrentContext(req);
    if (!req.ctx?.user) return res.status(401).json({ error:'Account not found or inactive.' });
    next();
  } catch (e) { next(e); }
}
function requireHouse(req, res, next) { if (!req.ctx.house || !req.ctx.member) return res.status(409).json({ error:'Join or create a house before using this feature.' }); next(); }
function requireAdmin(req, res, next) { if (!req.ctx.member || req.ctx.member.role !== 'ADMIN') return res.status(403).json({ error:'Admin permission required.' }); next(); }
function requireHouseCreator(req, res, next) { if (!req.ctx.member || req.ctx.member.role !== 'ADMIN' || !req.ctx.member.isCreator) return res.status(403).json({ error:'House creator permission required.' }); next(); }
function requireMember(req, res, next) { if (!req.ctx.member) return res.status(403).json({ error:'House membership required.' }); next(); }
function audit(req, action, meta={}) { return AuditLog.create({ houseId:req.ctx.house?._id, userId:req.ctx.user._id, action, meta, ip:req.ip }); }
async function createUserAndHouse({name,username,password,phone,email,houseName,capacity,maxTasksPerDay}) {
  const createSequential = async () => {
    const user = await User.create({ username, passwordHash: await hashPassword(password), name, phone, email });
    let inviteCode = makeInviteCode();
    while (await House.exists({ inviteCode })) inviteCode = makeInviteCode();
    const house = await House.create({ name:houseName || `${name}'s House`, inviteCode, ownerUserId:user._id, capacity, maxTasksPerDay });
    const member = await Member.create({ houseId:house._id, userId:user._id, name, phone, role:'ADMIN', isCreator:true, capabilities:{cook:true,clean:true,dishes:true,water:true}, availability:{morning:true,afternoon:true,evening:true,night:true}, preferred:[], avoided:[] });
    user.currentHouseId = house._id; user.currentMemberId = member._id; await user.save();
    await TaskDefinition.insertMany(BASE_TASKS.map(t => ({ houseId:house._id, ...t, active:true })));
    return { user, house, member };
  };
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        const user = await User.create([{ username, passwordHash: await hashPassword(password), name, phone, email }], { session }).then(a=>a[0]);
        let inviteCode = makeInviteCode();
        const taken = async () => !!(await House.exists({ inviteCode }));
        while (await taken()) inviteCode = makeInviteCode();
        const house = await House.create([{ name:houseName || `${name}'s House`, inviteCode, ownerUserId:user._id, capacity, maxTasksPerDay }], { session }).then(a=>a[0]);
        const member = await Member.create([{ houseId:house._id, userId:user._id, name, phone, role:'ADMIN', isCreator:true }], { session }).then(a=>a[0]);
        await User.updateOne({ _id:user._id }, { currentHouseId:house._id, currentMemberId:member._id }, { session });
        await TaskDefinition.insertMany(BASE_TASKS.map(t => ({ houseId:house._id, ...t, active:true })), { session });
        user.currentHouseId = house._id; user.currentMemberId = member._id;
        result = { user, house, member };
      });
      return result;
    } catch (e) {
      const transactionUnsupported = /transaction|replica set|replicaSet|Transaction numbers/i.test(e?.message || '');
      if (!transactionUnsupported) throw e;
      return await createSequential();
    }
  } finally { await session.endSession().catch(()=>{}); }
}

async function createHouseForUser({user,name,houseName,capacity,maxTasksPerDay,phone,email}) {
  const inviteCode = makeInviteCode();
  const house = await House.create({ name:houseName || `${name}'s House`, inviteCode, ownerUserId:user._id, capacity, maxTasksPerDay });
  const member = await Member.create({ houseId:house._id, userId:user._id, name, phone:phone || user.phone || '', role:'ADMIN', isCreator:true });
  if (email) { user.email = email; user.emailVerifiedAt = null; }
  await TaskDefinition.insertMany(BASE_TASKS.map(t => ({ houseId:house._id, ...t, active:true })));
  user.currentHouseId = house._id; user.currentMemberId = member._id; if (phone) user.phone=phone; if (email) user.email=email; await user.save();
  return { house, member };
}

function validateUserPayload(body) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || '');
  const name = safe(body.name,80);
  const email = normalizeEmail(body.email || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return { error:'Username must be 3–40 characters using letters, numbers, dot, underscore or hyphen.' };
  if (password.length < 8) return { error:'Password must be at least 8 characters.' };
  if (!name) return { error:'Name is required.' };
  if (!email || !validEmail(email)) return { error:'A valid email address is required.' };
  return { username,password,name,email };
}

app.get('/api/health', (_req,res)=>res.json({ok:true, service:'Bachelor House Manager API', version:'6.0.0'}));
app.get('/api/ready', async (_req,res)=>{ try { await connectDB(); res.json({ok:true,database:'connected',time:new Date().toISOString()}); } catch(e) { res.status(503).json({ok:false,error:'Database unavailable'}); } });

app.post('/api/auth/register', authLimiter, async (req,res,next)=>{
  try {
    const v=validateUserPayload(req.body); if(v.error) return res.status(400).json({error:v.error});
    const phone = normalizePhone(req.body.phone || ''); if(phone && !validPhone(phone)) return res.status(400).json({error:'Invalid mobile number.'});
    if(await User.exists({username:v.username})) return res.status(409).json({error:'Username is already registered.'});
    const mode = req.body.mode === 'create' ? 'create' : 'join';
    if (mode === 'join') {
      const invite = safe(req.body.inviteCode,30).toUpperCase();
      if (!invite) return res.status(400).json({error:'House invite code is required.'});
      if (!phone) return res.status(400).json({error:'WhatsApp/mobile number is required when joining a house.'});
      const house = await House.findOne({inviteCode:invite,active:true}); if(!house) return res.status(404).json({error:'Invalid or inactive house invite code.'});
      const count = await Member.countDocuments({houseId:house._id,active:true}); if(count >= house.capacity) return res.status(409).json({error:`This house is full (${house.capacity} members).`});
      const user = await User.create({username:v.username,passwordHash:await hashPassword(v.password),name:v.name,phone,email:v.email});
      const member = await Member.create({houseId:house._id,userId:user._id,name:v.name,phone,role:'MEMBER',isCreator:false});
      user.currentHouseId=house._id; user.currentMemberId=member._id; await user.save();
      const verifyToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      user.emailVerificationExpiresAt = new Date(Date.now() + Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 24) * 60 * 60 * 1000);
      await user.save();
      const token=signToken(user); await Notification.create({houseId:house._id,userId:house.ownerUserId,title:'New roommate joined 🎉',message:`${v.name} joined your house.`,type:'member_join'});
      const verification = await sendVerificationEmail({to:v.email,name:v.name,verifyUrl:`${(process.env.CLIENT_URL || origins[0] || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'')}/?verify=${verifyToken}`}).catch(e=>({sent:false,reason:e.message})); await AuditLog.create({houseId:house._id,userId:user._id,action:'member_joined',meta:{memberId:id(member._id)},ip:req.ip}).catch(()=>{});
      return res.status(201).json({token,user:publicUser(user,member),verification});
    }
    const capacity = Math.min(MAX_CAPACITY, Math.max(2, Number(req.body.capacity || DEFAULT_CAPACITY)));
    const maxTasksPerDay = Math.min(10, Math.max(1, Number(req.body.maxTasksPerDay || DEFAULT_MAX_TASKS)));
    const result = await createUserAndHouse({name:v.name,username:v.username,password:v.password,phone,email:v.email,houseName:safe(req.body.houseName,100),capacity,maxTasksPerDay});
    const verifyToken = crypto.randomBytes(32).toString('hex');
    result.user.emailVerificationTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
    result.user.emailVerificationExpiresAt = new Date(Date.now() + Number(process.env.EMAIL_VERIFICATION_TTL_HOURS || 24) * 60 * 60 * 1000);
    await result.user.save();
    const verification = await sendVerificationEmail({to:v.email,name:v.name,verifyUrl:`${(process.env.CLIENT_URL || origins[0] || `${req.protocol}://${req.get('host')}`).replace(/\/$/,'')}/?verify=${verifyToken}`}).catch(e=>({sent:false,reason:e.message}));
    const token=signToken(result.user); res.status(201).json({token,user:publicUser(result.user,result.member),house:housePublic(result.house),verification});
  } catch(e){ if(e?.code===11000) return res.status(409).json({error:'That username or invite value is already in use.'}); next(e); }
});

app.post('/api/auth/login', authLimiter, async (req,res,next)=>{
  try {
    const username=normalizeUsername(req.body.username); const password=String(req.body.password||'');
    const user=await User.findOne({username,status:'active'}); if(!user || !(await verifyPassword(password,user.passwordHash))) return res.status(401).json({error:'Invalid username or password.'});
    user.lastLoginAt=new Date(); await user.save(); const member=user.currentMemberId?await Member.findOne({_id:user.currentMemberId,userId:user._id,active:true}):null;
    if(!member) return res.status(409).json({error:'Your account is not connected to an active house. Create or join a house first.'});
    return res.json({token:signToken(user),user:publicUser(user,member)});
  } catch(e){next(e);}
});
app.get('/api/auth/me', auth, async (req,res)=>res.json({user:publicUser(req.ctx.user,req.ctx.member)}));
app.post('/api/auth/logout', auth, async (req,res)=>{ await audit(req,'logout'); res.json({ok:true}); });

app.post('/api/houses', auth, async (req,res,next)=>{ try {
  if(req.ctx.house) return res.status(409).json({error:'Your account already has an active house.'});
  const name=safe(req.body.name,100) || `${req.ctx.user.name}'s House`; const capacity=Math.min(MAX_CAPACITY,Math.max(2,Number(req.body.capacity||DEFAULT_CAPACITY))); const maxTasksPerDay=Math.min(10,Math.max(1,Number(req.body.maxTasksPerDay||DEFAULT_MAX_TASKS)));
  const result=await createHouseForUser({user:req.ctx.user,name:req.ctx.user.name,houseName:name,capacity,maxTasksPerDay,phone:req.ctx.user.phone}); await audit(req,'house_created',{houseId:id(result.house._id)}); res.status(201).json({house:housePublic(result.house),member:memberPublic(result.member),user:publicUser(req.ctx.user,result.member)});
 }catch(e){next(e);} });
app.post('/api/houses/join', auth, async(req,res,next)=>{try{
  if(req.ctx.house) return res.status(409).json({error:'You are already in an active house.'}); const invite=safe(req.body.inviteCode,30).toUpperCase(); if(!invite) return res.status(400).json({error:'Invite code required.'}); const house=await House.findOne({inviteCode:invite,active:true}); if(!house) return res.status(404).json({error:'Invalid invite code.'}); const count=await Member.countDocuments({houseId:house._id,active:true}); if(count>=house.capacity) return res.status(409).json({error:'House is full.'}); const phone=normalizePhone(req.body.phone||req.ctx.user.phone||''); if(!validPhone(phone)) return res.status(400).json({error:'Valid mobile number is required.'}); const member=await Member.create({houseId:house._id,userId:req.ctx.user._id,name:req.body.name||req.ctx.user.name,phone,role:'MEMBER'}); req.ctx.user.currentHouseId=house._id; req.ctx.user.currentMemberId=member._id; req.ctx.user.phone=phone; await req.ctx.user.save(); res.status(201).json({house:housePublic(house),member:memberPublic(member),user:publicUser(req.ctx.user,member)});
} catch(e){next(e);} });
app.get('/api/houses/join-preview/:code', async(req,res,next)=>{try{const h=await House.findOne({inviteCode:safe(req.params.code,30).toUpperCase(),active:true}).select('name capacity timezone'); if(!h)return res.status(404).json({error:'Invite not found.'}); const count=await Member.countDocuments({houseId:h._id,active:true}); res.json({houseName:h.name,capacity:h.capacity,joined:count,openSlots:Math.max(0,h.capacity-count),timezone:h.timezone});}catch(e){next(e);}});


app.get('/api/profile', auth, requireHouse, requireMember, async(req,res,next)=>{try{
  res.json({profile:{...publicUser(req.ctx.user,req.ctx.member),username:req.ctx.user.username,name:req.ctx.member.name,email:req.ctx.user.email||'',emailVerified:Boolean(req.ctx.user.emailVerifiedAt),emailVerifiedAt:req.ctx.user.emailVerifiedAt||null,availability:req.ctx.member.availability,capabilities:req.ctx.member.capabilities,preferred:req.ctx.member.preferred,avoided:req.ctx.member.avoided}});
}catch(e){next(e);}});
app.get('/api/profile/members', auth, requireHouse, requireMember, async(req,res,next)=>{try{
  const members=await Member.find({houseId:req.ctx.house._id,active:true}).sort({joinedAt:1});
  const users=await User.find({_id:{$in:members.map(m=>m.userId)}}).select('email emailVerifiedAt');
  const byUser=new Map(users.map(u=>[id(u._id),u]));
  res.json({members:members.map(m=>{const u=byUser.get(id(m.userId)); return {...memberPublic(m),email:u?.email||'',emailVerified:Boolean(u?.emailVerifiedAt),username:u?.username||''};})});
}catch(e){next(e);}});
app.patch('/api/profile', auth, requireHouse, requireMember, async(req,res,next)=>{try{
  const m=req.ctx.member; const u=req.ctx.user;
  if(req.body.name!==undefined){const name=safe(req.body.name,80);if(!name)return res.status(400).json({error:'Name cannot be empty.'});m.name=name;u.name=name;}
  if(req.body.phone!==undefined){const p=normalizePhone(req.body.phone);if(!validPhone(p))return res.status(400).json({error:'Invalid mobile number.'});m.phone=p;u.phone=p;}
  if(req.body.avatar!==undefined){const avatar=safe(req.body.avatar,300000);if(avatar.length > 260000)return res.status(413).json({error:'Profile photo is too large. Choose a smaller image.'});if(avatar && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatar) && !/^https?:\/\//.test(avatar))return res.status(400).json({error:'Profile photo must be an image URL or uploaded image.'});m.avatar=avatar;}
  if(req.body.availability)m.availability={...m.availability,...req.body.availability};
  if(req.body.capabilities)m.capabilities={...m.capabilities,...req.body.capabilities};
  if(Array.isArray(req.body.preferred))m.preferred=req.body.preferred.slice(0,20).map(x=>safe(x,60));
  if(Array.isArray(req.body.avoided))m.avoided=req.body.avoided.slice(0,20).map(x=>safe(x,60));
  let verification=null;
  if(req.body.email!==undefined){const email=normalizeEmail(req.body.email);if(!validEmail(email))return res.status(400).json({error:'Invalid email address.'});if(email!==u.email){if(await User.exists({email,_id:{$ne:u._id}}))return res.status(409).json({error:'That email is already registered.'});u.email=email;u.emailVerifiedAt=null;const verifyToken=crypto.randomBytes(32).toString('hex');u.emailVerificationTokenHash=crypto.createHash('sha256').update(verifyToken).digest('hex');u.emailVerificationExpiresAt=new Date(Date.now()+Number(process.env.EMAIL_VERIFICATION_TTL_HOURS||24)*3600000);verification=await sendVerificationEmail({to:email,name:m.name,verifyUrl:`${(process.env.CLIENT_URL||origins[0]||req.protocol+ '://' + req.get('host')).replace(/\/$/,'')}/?verify=${verifyToken}`}).catch(e=>({sent:false,reason:e.message}));}}
  await m.save();await u.save();await audit(req,'profile_updated',{emailChanged:req.body.email!==undefined,phoneChanged:req.body.phone!==undefined});
  res.json({profile:{...publicUser(u,m),username:u.username,email:u.email||'',emailVerified:Boolean(u.emailVerifiedAt),emailVerifiedAt:u.emailVerifiedAt||null,availability:m.availability,capabilities:m.capabilities,preferred:m.preferred,avoided:m.avoided},verification});
}catch(e){next(e);}});
app.post('/api/profile/resend-verification', auth, requireHouse, requireMember, async(req,res,next)=>{try{
  if(!req.ctx.user.email)return res.status(400).json({error:'Add an email address first.'});
  if(req.ctx.user.emailVerifiedAt)return res.json({sent:false,alreadyVerified:true});
  const verifyToken=crypto.randomBytes(32).toString('hex');req.ctx.user.emailVerificationTokenHash=crypto.createHash('sha256').update(verifyToken).digest('hex');req.ctx.user.emailVerificationExpiresAt=new Date(Date.now()+Number(process.env.EMAIL_VERIFICATION_TTL_HOURS||24)*3600000);await req.ctx.user.save();
  const result=await sendVerificationEmail({to:req.ctx.user.email,name:req.ctx.member.name,verifyUrl:`${(process.env.CLIENT_URL||origins[0]||req.protocol+ '://' + req.get('host')).replace(/\/$/,'')}/?verify=${verifyToken}`});res.json(result);
}catch(e){next(e);}});
app.post('/api/profile/change-password', auth, async(req,res,next)=>{try{
  const current=String(req.body.currentPassword||'');const nextPass=String(req.body.newPassword||'');if(nextPass.length<8)return res.status(400).json({error:'New password must be at least 8 characters.'});if(!(await verifyPassword(current,req.ctx.user.passwordHash)))return res.status(401).json({error:'Current password is incorrect.'});req.ctx.user.passwordHash=await hashPassword(nextPass);req.ctx.user.passwordChangedAt=new Date();await req.ctx.user.save();await audit(req,'password_changed');res.json({ok:true});
}catch(e){next(e);}});
app.get('/api/auth/verify-email', async(req,res,next)=>{try{
  const token=safe(req.query.token,200);if(!token)return res.status(400).json({error:'Verification token is required.'});const hash=crypto.createHash('sha256').update(token).digest('hex');const user=await User.findOne({emailVerificationTokenHash:hash,emailVerificationExpiresAt:{$gt:new Date()},status:'active'});if(!user)return res.status(400).json({error:'Verification link is invalid or expired.'});user.emailVerifiedAt=new Date();user.emailVerificationTokenHash=null;user.emailVerificationExpiresAt=null;await user.save();res.json({ok:true,message:'Email verified successfully.'});
}catch(e){next(e);}});
app.get('/api/email/status', auth, requireHouse, requireMember, (req,res)=>res.json({email:emailStatus()}));


app.get('/api/security/status', auth, requireHouse, requireHouseCreator, async (req, res, next) => {
  try {
    const deviceCount = await DeviceToken.countDocuments({ userId: req.ctx.user._id, houseId: req.ctx.house._id, active: true });
    const lastPasswordChange = req.ctx.user.passwordChangedAt ? req.ctx.user.passwordChangedAt.toISOString() : null;
    const apiLimit = Number(process.env.API_RATE_LIMIT || 1200);
    const rateWindowMs = Number(process.env.API_RATE_WINDOW_MS || 60000);
    res.json({
      account: {
        username: req.ctx.user.username,
        emailVerified: Boolean(req.ctx.user.emailVerifiedAt),
        phoneConfigured: Boolean(req.ctx.member.phone),
        status: req.ctx.user.status,
        passwordChangedAt: lastPasswordChange
      },
      protection: {
        helmet: true,
        corsAllowlist: origins.length > 0,
        compression: true,
        bodyLimit: '1mb',
        apiRateLimit: `${apiLimit} requests / ${Math.round(rateWindowMs/1000)}s per IP`,
        authRateLimit: `${Number(process.env.AUTH_RATE_LIMIT || 15)} attempts / 15m per IP`,
        bcryptRounds: 12,
        jwtTtl: process.env.TOKEN_TTL || '7d',
        tenantIsolation: true,
        requestId: true,
        database: mongoose.connection.readyState === 1 ? 'connected' : 'degraded'
      },
      notifications: {
        fcm: fcmStatus(),
        activeDevices: deviceCount
      },
      house: { id: id(req.ctx.house._id), memberRole: req.ctx.member.role },
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString()
    });
  } catch (e) { next(e); }
});

app.get('/api/security/events', auth, requireHouse, requireHouseCreator, async (req, res, next) => {
  try {
    const events = await AuditLog.find({ houseId: req.ctx.house._id, userId: req.ctx.user._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ events });
  } catch (e) { next(e); }
});

app.post('/api/security/revoke-sessions', auth, async (req, res, next) => {
  try {
    req.ctx.user.tokenVersion = Number(req.ctx.user.tokenVersion || 0) + 1;
    await req.ctx.user.save();
    await DeviceToken.updateMany({ userId: req.ctx.user._id }, { $set: { active: false } });
    await audit(req, 'all_sessions_revoked');
    res.json({ ok: true, message: 'All other sessions and registered push devices have been revoked.' });
  } catch (e) { next(e); }
});

app.get('/api/notifications/devices', auth, requireHouse, requireMember, async (req, res, next) => {
  try {
    const devices = await DeviceToken.find({ userId: req.ctx.user._id, houseId: req.ctx.house._id, active: true }).select('token platform lastSeenAt createdAt userAgent').sort({ lastSeenAt: -1 }).limit(20).lean();
    res.json({ devices: devices.map(d => ({ id:id(d._id), platform:d.platform, lastSeenAt:d.lastSeenAt, createdAt:d.createdAt, userAgent:d.userAgent.slice(0,160), tokenPreview:`${d.token.slice(0,8)}…${d.token.slice(-6)}` })) });
  } catch (e) { next(e); }
});

app.post('/api/notifications/device', auth, requireHouse, requireMember, async (req, res, next) => {
  try {
    const token = safe(req.body.token, 4096);
    const platform = ['web','android','ios'].includes(req.body.platform) ? req.body.platform : 'web';
    if (!token || token.length < 20) return res.status(400).json({ error:'Invalid push token.' });
    const doc = await DeviceToken.findOneAndUpdate(
      { token },
      { $set:{ userId:req.ctx.user._id, houseId:req.ctx.house._id, platform, active:true, lastSeenAt:new Date(), userAgent:safe(req.headers['user-agent'],300) } },
      { upsert:true, new:true, setDefaultsOnInsert:true }
    );
    await audit(req, 'push_device_registered', { platform });
    res.status(201).json({ ok:true, deviceId:id(doc._id), fcm:fcmStatus() });
  } catch (e) { next(e); }
});

app.delete('/api/notifications/device', auth, requireHouse, requireMember, async (req, res, next) => {
  try {
    const token = safe(req.body?.token, 4096);
    if (!token) return res.status(400).json({ error:'Push token is required.' });
    await DeviceToken.updateOne({ userId:req.ctx.user._id, houseId:req.ctx.house._id, token }, { $set:{ active:false } });
    res.json({ ok:true });
  } catch (e) { next(e); }
});

app.get('/api/today', auth, requireHouse, async(req,res,next)=>{try{const date=localDateString(new Date(), req.ctx.house.timezone || TIME_ZONE); const assignments=await Assignment.find({houseId:req.ctx.house._id,date}).sort({time:1}); const members=await Member.find({houseId:req.ctx.house._id,active:true}).sort({joinedAt:1}); const announcements=await Announcement.find({houseId:req.ctx.house._id}).sort({createdAt:-1}).limit(5); const dailyLogs=await MessageLog.find({houseId:req.ctx.house._id,date}).sort({createdAt:-1}).limit(100); res.json({house:housePublic(req.ctx.house),currentUser:publicUser(req.ctx.user,req.ctx.member),members:members.map(memberPublic),assignments:assignments.map(assignmentPublic),announcements:announcements.map(json),messageSummary:{sent:dailyLogs.filter(x=>x.success).length,failed:dailyLogs.filter(x=>!x.success).length}});}catch(e){next(e);}});
app.get('/api/schedule', auth, requireHouse, requireAdmin, async(req,res,next)=>{try{const start=weekStart(localDateString(new Date(), req.ctx.house.timezone || TIME_ZONE)); const dates=Array.from({length:7},(_,i)=>addDays(start,i)); const assignments=await Assignment.find({houseId:req.ctx.house._id,date:{$in:dates}}).sort({date:1,time:1}); const days=dates.map(date=>({date,day:dayName(date),assignments:assignments.filter(a=>a.date===date).map(assignmentPublic)})); res.json({start,days});}catch(e){next(e);}});

async function generateWeekForHouse(house, generatedBy='system', force=false) {
  const start=weekStart(localDateString(new Date(), house.timezone || TIME_ZONE));
  if(!force){const existing=await Schedule.findOne({houseId:house._id,weekStart:start}); if(existing)return {schedule:existing,created:false};}
  if(force){ await Assignment.deleteMany({houseId:house._id,date:{$gte:start,$lte:addDays(start,6)}}); await Schedule.deleteMany({houseId:house._id,weekStart:start}); await MessageJob.deleteMany({houseId:house._id,date:{$gte:start,$lte:addDays(start,6)},type:'daily',status:{$in:['queued','failed']}}); }
  let schedule; try { schedule=await Schedule.create({houseId:house._id,weekStart:start,generatedBy,version:1}); } catch(e) { if(e?.code===11000){schedule=await Schedule.findOne({houseId:house._id,weekStart:start}); if(schedule)return {schedule,created:false};} throw e; }
  const members=await Member.find({houseId:house._id,active:true}); const tasks=await TaskDefinition.find({houseId:house._id,active:true}).sort({time:1}); const history=await Assignment.find({houseId:house._id,date:{$gte:addDays(start,-7),$lt:start}}).lean(); const projected=[];
  for(let dayIndex=0;dayIndex<7;dayIndex++){
    const date=addDays(start,dayIndex); let water1=null;
    for(const task of tasks){
      const blocked=new Set(); if(task.key==='water_set_2' && water1) blocked.add(id(water1._id));
      const chosen=chooseMember({members,task,date,history,projected,settings:house.toObject(),blockedIds:blocked}); if(!chosen) continue;
      const explanation=`Balanced by availability, projected workload, 7-day effort, preferences and recent-task rotation.`;
      const item={houseId:house._id,scheduleId:schedule._id,date,taskId:task._id,taskKey:task.key,taskName:task.name,category:task.category,time:task.time,timeSlot:task.timeSlot,effort:task.effort,icon:task.icon,assignedToMemberId:chosen._id,status:'pending',explanation};
      projected.push({...item,assignedToMemberId:chosen._id}); if(task.key==='water_set_1') water1=chosen;
    }
  }
  if(projected.length) await Assignment.insertMany(projected,{ordered:false});
  await Schedule.updateOne({_id:schedule._id},{generatedAt:new Date()});
  return {schedule,created:true};
}

async function queueDailyJobsForHouse(house, date=localDateString()) {
  const assignments=await Assignment.find({houseId:house._id,date}).sort({time:1}); if(!assignments.length)return {queued:0}; const members=await Member.find({houseId:house._id,active:true}); const grouped=new Map(); for(const a of assignments){const key=id(a.assignedToMemberId); if(!grouped.has(key))grouped.set(key,[]); grouped.get(key).push(a);}
  let queued=0;
  for(const m of members){const list=grouped.get(id(m._id))||[]; if(!list.length)continue; await Notification.create({houseId:house._id,userId:m.userId,title:'Your house tasks are ready 🏠',message:list.map(a=>`${a.icon} ${a.taskName} at ${a.time}`).join(' • '),type:'daily_task'}); if(!m.phone){await MessageLog.create({houseId:house._id,memberId:m._id,type:'daily',date,phone:'',success:false,reason:'No mobile number on member profile.',body:list.map(a=>`${a.taskName} ${a.time}`).join('\n')});continue;} if(process.env.WHATSAPP_ENABLED!=='true') continue; const key=`daily:${id(house._id)}:${id(m._id)}:${date}`; const job=await MessageJob.updateOne({dedupeKey:key},{$setOnInsert:{houseId:house._id,memberId:m._id,type:'daily',date,dedupeKey:key,status:'queued',payload:{assignmentIds:list.map(id),memberName:m.name,houseName:house.name,tasks:list.map(a=>({name:a.taskName,time:a.time,icon:a.icon,effort:a.effort}))},nextAttemptAt:new Date()}},{upsert:true}); if(job.upsertedCount)queued++;}
  return {queued};
}

app.post('/api/schedule/generate',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const result=await generateWeekForHouse(req.ctx.house,'admin',Boolean((req.body || {}).force)); await audit(req,'schedule_generated',{weekStart:result.schedule.weekStart,forced:Boolean((req.body || {}).force)}); const week=await Assignment.find({houseId:req.ctx.house._id,date:{$gte:result.schedule.weekStart,$lte:addDays(result.schedule.weekStart,6)}}).sort({date:1,time:1}); res.json({ok:true,created:result.created,weekly:week.map(assignmentPublic),assignments:week.filter(a=>a.date===localDateString()).map(assignmentPublic)});}catch(e){next(e);}});
app.post('/api/automation/run-now',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{await generateWeekForHouse(req.ctx.house,'admin',Boolean((req.body || {}).force)); const q=await queueDailyJobsForHouse(req.ctx.house, localDateString(new Date(), req.ctx.house.timezone || TIME_ZONE)); await audit(req,'automation_run_now',{queued:q.queued}); const assignments=await Assignment.find({houseId:req.ctx.house._id,date:localDateString()}).sort({time:1}); res.json({ok:true,assignments:assignments.map(assignmentPublic),messageResult:{queued:q.queued,sent:0,failed:0,details:[]}});}catch(e){next(e);}});
app.get('/api/automation/status',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const date=localDateString(new Date(), req.ctx.house.timezone || TIME_ZONE); const [schedule,queued,sent,failed,messages]=await Promise.all([Schedule.findOne({houseId:req.ctx.house._id,weekStart:weekStart(date)}),MessageJob.countDocuments({houseId:req.ctx.house._id,date,status:'queued'}),MessageLog.countDocuments({houseId:req.ctx.house._id,date,type:'daily',success:true}),MessageLog.countDocuments({houseId:req.ctx.house._id,date,type:'daily',success:false}),MessageLog.find({houseId:req.ctx.house._id}).sort({createdAt:-1}).limit(50)]); res.json({timezone:TIME_ZONE,dailyTime:`${String(DAILY_HOUR).padStart(2,'0')}:${String(DAILY_MINUTE).padStart(2,'0')}`,today:date,scheduleReady:!!schedule,weeklyScheduleId:schedule? id(schedule._id):null, whatsappConfigured:whatsappStatus().configured, whatsappEnabled:whatsappStatus().enabled, fcm:fcmStatus(), messageSummary:{sent,failed,queued},messages:messages.map(json)});}catch(e){next(e);}});

app.post('/api/tasks/:id/complete',auth,requireHouse,requireMember,async(req,res,next)=>{try{const a=await Assignment.findOne({_id:req.params.id,houseId:req.ctx.house._id}); if(!a)return res.status(404).json({error:'Assignment not found.'}); const can=req.ctx.member.role==='ADMIN' || id(a.assignedToMemberId)===id(req.ctx.member._id); if(!can)return res.status(403).json({error:'You can only complete your own tasks.'}); if(a.status==='completed')return res.json({assignment:assignmentPublic(a)}); a.status='completed'; a.completedAt=new Date(); a.completedByUserId=req.ctx.user._id; await a.save(); await Notification.create({houseId:req.ctx.house._id,userId:req.ctx.user._id,title:'Task completed ✅',message:`${a.taskName} marked completed.`,type:'task_completed'}); await audit(req,'task_completed',{assignmentId:id(a._id)}); res.json({assignment:assignmentPublic(a)});}catch(e){next(e);}});
app.post('/api/tasks/:id/replace',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const a=await Assignment.findOne({_id:req.params.id,houseId:req.ctx.house._id}); if(!a)return res.status(404).json({error:'Assignment not found.'}); const m=await Member.findOne({_id:req.body.replacementMemberId,houseId:req.ctx.house._id,active:true}); if(!m)return res.status(404).json({error:'Replacement member not found.'}); a.assignedToMemberId=m._id;a.status='reassigned';await a.save();await Notification.create({houseId:req.ctx.house._id,userId:m.userId,title:'Task reassigned to you',message:`${a.taskName} is now assigned to you for ${a.date}.`,type:'assignment'});await audit(req,'task_reassigned',{assignmentId:id(a._id),toMemberId:id(m._id)});res.json({assignment:assignmentPublic(a)});}catch(e){next(e);}});

app.get('/api/swaps',auth,requireHouse,requireMember,async(req,res,next)=>{try{const filter={houseId:req.ctx.house._id}; if(req.ctx.member.role!=='ADMIN')filter.$or=[{fromMemberId:req.ctx.member._id},{toMemberId:req.ctx.member._id}]; const items=await SwapRequest.find(filter).sort({createdAt:-1}).limit(100); res.json({swapRequests:items.map(json)});}catch(e){next(e);}});
app.post('/api/swaps',auth,requireHouse,requireMember,async(req,res,next)=>{try{const a=await Assignment.findOne({_id:req.body.taskId,houseId:req.ctx.house._id,assignedToMemberId:req.ctx.member._id,status:'pending'}); if(!a)return res.status(404).json({error:'Only your pending task can be swapped.'});const target=await Member.findOne({_id:req.body.toMemberId,houseId:req.ctx.house._id,active:true}); if(!target)return res.status(404).json({error:'Target roommate not found.'}); const sw=await SwapRequest.create({houseId:req.ctx.house._id,taskId:a._id,taskName:a.taskName,fromMemberId:req.ctx.member._id,toMemberId:target._id,date:a.date}); await Notification.create({houseId:req.ctx.house._id,userId:target.userId,title:'New task swap request 🔄',message:`${req.ctx.member.name} wants to swap ${a.taskName}.`,type:'swap'}); res.status(201).json({swapRequest:json(sw)});}catch(e){next(e);}});
app.post('/api/swaps/:id/accept',auth,requireHouse,requireMember,async(req,res,next)=>{try{const sw=await SwapRequest.findOne({_id:req.params.id,houseId:req.ctx.house._id,status:'pending',toMemberId:req.ctx.member._id});if(!sw)return res.status(404).json({error:'Swap request not found.'}); const a=await Assignment.findOne({_id:sw.taskId,houseId:req.ctx.house._id}); const other=await Assignment.findOne({houseId:req.ctx.house._id,date:sw.date,assignedToMemberId:req.ctx.member._id,status:'pending'}).sort({time:1}); if(!a)return res.status(404).json({error:'Original assignment missing.'}); if(other){a.assignedToMemberId=req.ctx.member._id; other.assignedToMemberId=sw.fromMemberId; other.status='swapped'; await other.save();} else a.assignedToMemberId=sw.toMemberId; a.status='swapped'; await a.save(); sw.status='accepted'; await sw.save(); await audit(req,'swap_accepted',{swapId:id(sw._id)}); res.json({swapRequest:json(sw),assignments:[assignmentPublic(a),...(other?[assignmentPublic(other)]:[])]});}catch(e){next(e);}});

app.get('/api/house',auth,requireHouse,(req,res)=>res.json({house:housePublic(req.ctx.house)}));
app.patch('/api/house',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const h=req.ctx.house;if(req.body.name!==undefined)h.name=safe(req.body.name,100)||h.name;if(req.body.capacity!==undefined)h.capacity=Math.min(MAX_CAPACITY,Math.max(2,Number(req.body.capacity)));if(req.body.maxTasksPerDay!==undefined)h.maxTasksPerDay=Math.min(10,Math.max(1,Number(req.body.maxTasksPerDay)));for(const k of ['morningCookCanCookLunch','autoReplacement'])if(req.body[k]!==undefined)h[k]=Boolean(req.body[k]);await h.save();await audit(req,'house_updated',{fields:Object.keys(req.body)});res.json({house:housePublic(h)});}catch(e){next(e);}});
app.get('/api/invite',auth,requireHouse,requireAdmin,async(req,res)=>res.json({inviteCode:req.ctx.house.inviteCode,joinUrl:`${(origins[0] || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/?invite=${encodeURIComponent(req.ctx.house.inviteCode)}`,memberCount:await Member.countDocuments({houseId:req.ctx.house._id,active:true}),capacity:req.ctx.house.capacity}));
app.get('/api/members',auth,requireHouse,requireMember,async(req,res,next)=>{try{const ms=await Member.find({houseId:req.ctx.house._id,active:true}).sort({joinedAt:1});res.json({members:ms.map(memberPublic)});}catch(e){next(e);}});
app.patch('/api/members/:id',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const m=await Member.findOne({_id:req.params.id,houseId:req.ctx.house._id,active:true});if(!m)return res.status(404).json({error:'Member not found.'});if(req.body.phone!==undefined){const p=normalizePhone(req.body.phone);if(!validPhone(p))return res.status(400).json({error:'Invalid mobile number.'});m.phone=p;await User.updateOne({_id:m.userId},{phone:p});}if(req.body.name!==undefined)m.name=safe(req.body.name,80);if(req.body.capabilities)m.capabilities={...m.capabilities,...req.body.capabilities};if(req.body.availability)m.availability={...m.availability,...req.body.availability};if(Array.isArray(req.body.preferred))m.preferred=req.body.preferred.slice(0,20);if(Array.isArray(req.body.avoided))m.avoided=req.body.avoided.slice(0,20);await m.save();res.json({member:memberPublic(m)});}catch(e){next(e);}});
app.delete('/api/members/:id',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const m=await Member.findOne({_id:req.params.id,houseId:req.ctx.house._id,active:true});if(!m)return res.status(404).json({error:'Member not found.'});if(m.isCreator)return res.status(400).json({error:'The house creator cannot be removed.'});m.active=false;await m.save();await User.updateOne({_id:m.userId},{$set:{currentHouseId:null,currentMemberId:null}});await Assignment.updateMany({houseId:req.ctx.house._id,assignedToMemberId:m._id,status:'pending'},{$set:{status:'reassigned'}});await audit(req,'member_removed',{memberId:id(m._id)});res.json({ok:true});}catch(e){next(e);}});

function listRoute(Model, key, options={}) { app.get(`/api/${key}`,auth,requireHouse,requireMember,async(req,res,next)=>{try{const q={houseId:req.ctx.house._id,...(options.filter?options.filter(req):{})};const docs=await Model.find(q).sort({createdAt:-1}).limit(options.limit||200);res.json({[options.responseKey||key]:docs.map(json)});}catch(e){next(e);}}); }
app.post('/api/expenses',auth,requireHouse,requireMember,async(req,res,next)=>{try{const amount=Number(req.body.amount);const date=safe(req.body.date,10)||localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE);const currentMonth=localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE).slice(0,7);if(!safe(req.body.title,100)||!Number.isFinite(amount)||amount<0)return res.status(400).json({error:'Expense title and non-negative amount are required.'});if(monthKey(date)!==currentMonth)return res.status(400).json({error:'Expenses can only be added to the current month. Previous months are archived.'});const e=await Expense.create({houseId:req.ctx.house._id,title:safe(req.body.title,100),amount,category:safe(req.body.category,40)||'Other',date,paidByMemberId:req.ctx.member._id});await audit(req,'expense_created',{expenseId:id(e._id),amount,title:e.title});res.status(201).json({expense:json(e)});}catch(e){next(e);}});
app.patch('/api/expenses/:id',auth,requireHouse,requireHouseCreator,async(req,res,next)=>{try{const e=await Expense.findOne({_id:req.params.id,houseId:req.ctx.house._id});if(!e)return res.status(404).json({error:'Expense not found.'});const currentMonth=localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE).slice(0,7);if(monthKey(e.date)!==currentMonth)return res.status(400).json({error:'Archived expenses cannot be edited.'});if(req.body.title!==undefined){const title=safe(req.body.title,100);if(!title)return res.status(400).json({error:'Expense title is required.'});e.title=title;}if(req.body.amount!==undefined){const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<0)return res.status(400).json({error:'Expense amount must be non-negative.'});e.amount=amount;}if(req.body.category!==undefined)e.category=safe(req.body.category,40)||'Other';await e.save();await audit(req,'expense_updated',{expenseId:id(e._id)});res.json({expense:json(e)});}catch(e){next(e);}});
app.delete('/api/expenses/:id',auth,requireHouse,requireHouseCreator,async(req,res,next)=>{try{const e=await Expense.findOne({_id:req.params.id,houseId:req.ctx.house._id});if(!e)return res.status(404).json({error:'Expense not found.'});const currentMonth=localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE).slice(0,7);if(monthKey(e.date)!==currentMonth)return res.status(400).json({error:'Archived expenses cannot be deleted.'});await Expense.deleteOne({_id:e._id});await audit(req,'expense_deleted',{expenseId:id(e._id),amount:e.amount,title:e.title});res.json({ok:true});}catch(e){next(e);}});
listRoute(Grocery,'groceries');
app.post('/api/groceries',auth,requireHouse,requireMember,async(req,res,next)=>{try{const g=await Grocery.create({houseId:req.ctx.house._id,name:safe(req.body.name,100),quantity:safe(req.body.quantity,30)||'1',category:safe(req.body.category,40)||'General'});res.status(201).json({grocery:g.toObject()});}catch(e){next(e);}});
app.patch('/api/groceries/:id',auth,requireHouse,requireMember,async(req,res,next)=>{try{const g=await Grocery.findOne({_id:req.params.id,houseId:req.ctx.house._id});if(!g)return res.status(404).json({error:'Grocery item not found.'});if(req.body.status)g.status=req.body.status;if(req.body.quantity!==undefined)g.quantity=safe(req.body.quantity,30);await g.save();res.json({grocery:json(g)});}catch(e){next(e);}});
listRoute(Meal,'meals');
app.post('/api/meals',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const m=await Meal.findOneAndUpdate({houseId:req.ctx.house._id,date:safe(req.body.date,10),mealType:safe(req.body.mealType,30)},{houseId:req.ctx.house._id,date:safe(req.body.date,10),mealType:safe(req.body.mealType,30),menu:safe(req.body.menu,200),notes:safe(req.body.notes,300)},{new:true,upsert:true,setDefaultsOnInsert:true});res.status(201).json({meal:json(m)});}catch(e){next(e);}});
listRoute(Announcement,'announcements');
app.post('/api/announcements',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const a=await Announcement.create({houseId:req.ctx.house._id,title:safe(req.body.title,120),message:safe(req.body.message,1000),createdByUserId:req.ctx.user._id});const members=await Member.find({houseId:req.ctx.house._id,active:true});for(const m of members) {await Notification.updateOne({dedupeKey:`announcement-notification:${a._id}:${m._id}`},{$setOnInsert:{houseId:req.ctx.house._id,userId:m.userId,title:a.title,message:a.message,type:'announcement',dedupeKey:`announcement-notification:${a._id}:${m._id}`}},{upsert:true});if(m.phone && process.env.WHATSAPP_ENABLED==='true'){const dedupeKey=`announcement:${id(a._id)}:${id(m._id)}`;await MessageJob.updateOne({dedupeKey},{$setOnInsert:{houseId:req.ctx.house._id,memberId:m._id,type:'announcement',date:localDateString(),dedupeKey,payload:{memberName:m.name,houseName:req.ctx.house.name,title:a.title,message:a.message},status:'queued',nextAttemptAt:new Date()}},{upsert:true});}}res.status(201).json({announcement:json(a)});}catch(e){next(e);}});
listRoute(Maintenance,'maintenance');
app.post('/api/maintenance',auth,requireHouse,requireMember,async(req,res,next)=>{try{const m=await Maintenance.create({houseId:req.ctx.house._id,title:safe(req.body.title,120),description:safe(req.body.description,1000),priority:req.body.priority||'normal',reportedByMemberId:req.ctx.member._id});if(req.ctx.member.role!=='ADMIN'){await Notification.create({houseId:req.ctx.house._id,userId:req.ctx.house.ownerUserId,title:'New maintenance issue 🔧',message:m.title,type:'maintenance'}).catch(()=>{});}res.status(201).json({maintenanceItem:json(m)});}catch(e){next(e);}});
app.patch('/api/maintenance/:id',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const m=await Maintenance.findOne({_id:req.params.id,houseId:req.ctx.house._id});if(!m)return res.status(404).json({error:'Maintenance issue not found.'});if(req.body.status)m.status=req.body.status;if(req.body.notes!==undefined)m.notes=safe(req.body.notes,1000);await m.save();res.json({maintenanceItem:json(m)});}catch(e){next(e);}});
listRoute(Inventory,'inventory');
app.post('/api/inventory',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const i=await Inventory.create({houseId:req.ctx.house._id,name:safe(req.body.name,120),category:safe(req.body.category,50)||'House',condition:safe(req.body.condition,50)||'Good',warrantyUntil:safe(req.body.warrantyUntil,20),notes:safe(req.body.notes,500)});res.status(201).json({inventoryItem:json(i)});}catch(e){next(e);}});
app.patch('/api/inventory/:id',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const i=await Inventory.findOne({_id:req.params.id,houseId:req.ctx.house._id});if(!i)return res.status(404).json({error:'Inventory item not found.'});if(req.body.condition!==undefined)i.condition=safe(req.body.condition,50);if(req.body.notes!==undefined)i.notes=safe(req.body.notes,500);await i.save();res.json({inventoryItem:json(i)});}catch(e){next(e);}});
listRoute(LeaveRequest,'leave',{responseKey:'leaveRequests',filter:req=>req.ctx.member.role==='ADMIN'?{}:{memberId:req.ctx.member._id}});
app.post('/api/leave',auth,requireHouse,requireMember,async(req,res,next)=>{try{const l=await LeaveRequest.create({houseId:req.ctx.house._id,memberId:req.ctx.member._id,start:safe(req.body.start,10),end:safe(req.body.end,10),reason:safe(req.body.reason,500)});if(req.ctx.member.role!=='ADMIN'){await Notification.create({houseId:req.ctx.house._id,userId:req.ctx.house.ownerUserId,title:'New leave request',message:`${req.ctx.member.name} requested leave ${l.start} to ${l.end}.`,type:'leave'});}res.status(201).json({leaveRequest:json(l)});}catch(e){next(e);}});
app.patch('/api/leave/:id',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const l=await LeaveRequest.findOne({_id:req.params.id,houseId:req.ctx.house._id});if(!l)return res.status(404).json({error:'Leave request not found.'});if(!['approved','rejected'].includes(req.body.status))return res.status(400).json({error:'Invalid leave status.'});l.status=req.body.status;await l.save();const m=await Member.findById(l.memberId);if(m?.userId){m.tempAbsent=l.status==='approved'?{start:l.start,end:l.end}:undefined;await m.save();await Notification.create({houseId:req.ctx.house._id,userId:m.userId,title:`Leave ${l.status}`,message:`Your leave request has been ${l.status}.`,type:'leave'});}res.json({leaveRequest:json(l)});}catch(e){next(e);}});
listRoute(Notification,'notifications',{responseKey:'notifications',filter:req=>({userId:req.ctx.user._id}),limit:100});
app.post('/api/notifications/:id/read',auth,requireHouse,requireMember,async(req,res,next)=>{try{await Notification.updateOne({_id:req.params.id,houseId:req.ctx.house._id,userId:req.ctx.user._id},{$set:{read:true}});res.json({ok:true});}catch(e){next(e);}});
app.get('/api/expenses',auth,requireHouse,requireMember,async(req,res,next)=>{try{res.json(await expensePayload(req.ctx.house));}catch(e){next(e);}});
app.post('/api/expenses/archive',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const current=localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE).slice(0,7);const requested=monthKey(req.body.monthKey)||previousMonthKey(current);if(!requested||requested>=current)return res.status(400).json({error:'Only a completed previous month can be archived.'});const archive=await archiveExpenseMonth(req.ctx.house,requested,req.ctx.user._id);res.json({archive:json(archive)});}catch(e){next(e);}});

app.get('/api/history',auth,requireHouse,requireMember,async(req,res,next)=>{try{const filter={houseId:req.ctx.house._id,status:'completed'};if(req.ctx.member.role!=='ADMIN')filter.assignedToMemberId=req.ctx.member._id;const history=await Assignment.find(filter).sort({completedAt:-1}).limit(200);res.json({history:history.map(assignmentPublic)});}catch(e){next(e);}});
app.get('/api/fairness',auth,requireHouse,requireMember,async(req,res,next)=>{try{const members=await Member.find({houseId:req.ctx.house._id,active:true});const since=addDays(localDateString(new Date(), req.ctx.house.timezone || TIME_ZONE),-7);const assignments=await Assignment.find({houseId:req.ctx.house._id,date:{$gte:since}}).lean();const stats=members.map(m=>{const mine=assignments.filter(a=>id(a.assignedToMemberId)===id(m._id));return {member:memberPublic(m),effort:mine.reduce((s,a)=>s+Number(a.effort||0),0),tasks:mine.length,completed:mine.filter(a=>a.status==='completed').length};});res.json({stats});}catch(e){next(e);}});
app.get('/api/analytics',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const members=await Member.find({houseId:req.ctx.house._id,active:true});const since=addDays(localDateString(),-7);const assignments=await Assignment.find({houseId:req.ctx.house._id,date:{$gte:since}}).lean();const stats=members.map(m=>{const mine=assignments.filter(a=>id(a.assignedToMemberId)===id(m._id));return {member:memberPublic(m),effort:mine.reduce((s,a)=>s+Number(a.effort||0),0),tasks:mine.length,completed:mine.filter(a=>a.status==='completed').length};});const messages=await MessageLog.find({houseId:req.ctx.house._id}).sort({createdAt:-1}).limit(100);res.json({stats,totals:{expenses:await Expense.aggregate([{$match:{houseId:req.ctx.house._id}},{$group:{_id:null,total:{$sum:'$amount'}}}]).then(r=>r[0]?.total||0),groceries:await Grocery.countDocuments({houseId:req.ctx.house._id,status:'open'}),maintenance:await Maintenance.countDocuments({houseId:req.ctx.house._id,status:{$ne:'fixed'}})},messages:messages.map(json)});}catch(e){next(e);}});
app.get('/api/automation/messages',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const messages=await MessageLog.find({houseId:req.ctx.house._id}).sort({createdAt:-1}).limit(200);res.json({messages:messages.map(json)});}catch(e){next(e);}});
app.post('/api/automation/test-member/:id',auth,requireHouse,requireAdmin,async(req,res,next)=>{try{const member=await Member.findOne({_id:req.params.id,houseId:req.ctx.house._id,active:true});if(!member)return res.status(404).json({error:'Member not found.'});if(!member.phone)return res.status(400).json({error:'Member has no mobile number.'});const contentSid=process.env.TWILIO_TEST_CONTENT_SID||process.env.TWILIO_TASK_CONTENT_SID;const result=await sendTemplate({to:member.phone,contentSid,variables:{'1':member.name,'2':req.ctx.house.name,'3':localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE),'4':'This is a test delivery from Bachelor House Manager.'}});await MessageLog.create({houseId:req.ctx.house._id,memberId:member._id,type:'test',date:localDateString(new Date(),req.ctx.house.timezone||TIME_ZONE),phone:member.phone,success:result.sent,sid:result.sid||'',reason:result.reason||'',body:'WhatsApp test message'});res.json({ok:result.sent,result,member:{id:id(member._id),name:member.name,phone:member.phone}});}catch(e){next(e);}});

app.use((_req,res)=>res.status(404).json({error:'Route not found.'}));
app.use((err,_req,res,_next)=>{console.error(err); if(err?.code===11000)return res.status(409).json({error:'A record with that unique value already exists.'}); if(err?.message?.includes('Origin not allowed'))return res.status(403).json({error:'Origin is not allowed.'}); res.status(500).json({error:process.env.NODE_ENV==='production'?'Internal server error.':err.message, requestId: _req?.requestId || undefined});});

async function start(){ await connectDB(); app.listen(PORT,'0.0.0.0',()=>console.log(`Bachelor House Manager API listening on port ${PORT}`)); }
process.on('SIGTERM', async ()=>{ try { await mongoose.connection.close(); } finally { process.exit(0); } });
process.on('SIGINT', async ()=>{ try { await mongoose.connection.close(); } finally { process.exit(0); } });
start().catch(e=>{console.error(e);process.exit(1);});
