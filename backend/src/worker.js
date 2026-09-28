import 'dotenv/config';
import { connectDB } from './db.js';
import { MessageJob, MessageLog, Member, Notification, PushJob, DeviceToken } from './models.js';
import { sendTemplate } from './whatsapp.js';
import { sendPush, fcmStatus } from './fcm.js';

const POLL_MS = Number(process.env.WORKER_POLL_MS || 1500);
const MAX_ATTEMPTS = Number(process.env.MESSAGE_MAX_ATTEMPTS || 4);
const PUSH_MAX_ATTEMPTS = Number(process.env.PUSH_MAX_ATTEMPTS || 4);

function variablesFor(job, member) {
  const p = job.payload || {};
  const taskText = (p.tasks || []).map(t => `${t.icon || '•'} ${t.name} at ${t.time}`).join('\n');
  return { '1': p.memberName || member.name, '2': p.houseName || 'House', '3': job.date, '4': p.message || p.title || taskText || 'Your household notification is ready.' };
}
function contentSidFor(job) {
  if (job.type === 'announcement') return process.env.TWILIO_ANNOUNCEMENT_CONTENT_SID || process.env.TWILIO_TASK_CONTENT_SID;
  if (job.type === 'reminder') return process.env.TWILIO_REMINDER_CONTENT_SID || process.env.TWILIO_TASK_CONTENT_SID;
  return process.env.TWILIO_TASK_CONTENT_SID;
}
async function claimMessageJob() {
  return MessageJob.findOneAndUpdate(
    { status:'queued', nextAttemptAt:{ $lte:new Date() } },
    { $set:{ status:'processing', lockedAt:new Date() }, $inc:{ attempts:1 } },
    { sort:{ createdAt:1 }, new:true }
  );
}
async function claimPushJob() {
  return PushJob.findOneAndUpdate(
    { status:'queued', nextAttemptAt:{ $lte:new Date() } },
    { $set:{ status:'processing', lockedAt:new Date() }, $inc:{ attempts:1 } },
    { sort:{ createdAt:1 }, new:true }
  );
}
async function processMessageJob(job) {
  const member = await Member.findOne({ _id:job.memberId, houseId:job.houseId, active:true });
  if (!member) throw new Error('Member no longer exists or is inactive.');
  if (!member.phone) throw new Error('Member has no WhatsApp/mobile number.');
  const result = await sendTemplate({ to:member.phone, contentSid:contentSidFor(job), variables:variablesFor(job, member) });
  if (!result.sent) throw new Error(result.reason || 'WhatsApp delivery failed.');
  job.status='sent'; job.providerMessageId=result.sid || ''; job.lastError=''; job.lockedAt=null; await job.save();
  await MessageLog.create({ houseId:job.houseId, memberId:member._id, type:job.type, date:job.date, phone:member.phone, success:true, sid:result.sid||'', body:job.type === 'daily' ? (job.payload?.tasks||[]).map(t=>`${t.name} ${t.time}`).join('\n') : (job.payload?.message || job.payload?.title || 'Notification'), reason:'' });
}
async function processPushJob(job) {
  if (!fcmStatus().configured) { job.status='failed'; job.lastError=fcmStatus().error || 'FCM is not configured.'; job.lockedAt=null; await job.save(); return; }
  const devices = await DeviceToken.find({ userId:job.userId, houseId:job.houseId, active:true }).select('token').lean();
  const tokens = devices.map(d=>d.token);
  if (!tokens.length) { job.status='failed'; job.lastError='No registered push devices for this user.'; job.lockedAt=null; await job.save(); return; }
  const result = await sendPush({ tokens, title:job.title, body:job.body, data:job.data || {} });
  if (!result.sent && !result.skipped) throw new Error(result.reason || 'Push delivery failed.');
  const responses = result.responses || [];
  const invalid = [];
  for (let i=0;i<responses.length;i++) {
    const r = responses[i];
    if (!r.success && /(registration-token-not-registered|invalid-registration-token|invalid argument)/i.test(r.error||'')) invalid.push(tokens[i]);
  }
  if (invalid.length) await DeviceToken.updateMany({ token:{ $in:invalid } }, { $set:{ active:false } });
  job.status='sent'; job.providerMessageId=responses.find(r=>r.success)?.messageId || ''; job.lastError=''; job.lockedAt=null; await job.save();
}
async function processOne(kind) {
  const job = kind==='push' ? await claimPushJob() : await claimMessageJob();
  if (!job) return false;
  try {
    if (kind==='push') await processPushJob(job); else await processMessageJob(job);
  } catch (error) {
    job.lastError = error.message; job.lockedAt=null;
    const max = kind==='push' ? PUSH_MAX_ATTEMPTS : MAX_ATTEMPTS;
    if (job.attempts >= max) {
      job.status='failed'; await job.save();
      if (kind !== 'push') {
        await MessageLog.create({ houseId:job.houseId, memberId:job.memberId, type:job.type, date:job.date, phone:'', success:false, sid:'', body:job.payload?.message || job.payload?.title || 'Notification', reason:error.message });
      }
      const member = await Member.findById(job.memberId).lean();
      if (member?.userId) await Notification.create({ houseId:job.houseId, userId:member.userId, title:'Notification delivery failed', message:`${job.type} notification could not be delivered: ${error.message}`, type:'delivery_error' }).catch(()=>{});
    } else {
      job.status='queued'; job.nextAttemptAt=new Date(Date.now()+Math.min(15*60_000,10000*(2**Math.max(0,job.attempts-1)))); await job.save();
    }
  }
  return true;
}

async function main(){
  await connectDB();
  console.log('Bachelor House Manager worker online');
  while(true){
    try {
      const didPush=await processOne('push');
      const didMessage=didPush ? true : await processOne('message');
      if(!didMessage) await new Promise(r=>setTimeout(r,POLL_MS));
    } catch(e) { console.error('[worker]',e.message); await new Promise(r=>setTimeout(r,POLL_MS)); }
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
