import 'dotenv/config';
import { connectDB, closeDB } from '../db.js';
import { House, Assignment, Member, MessageJob, Notification } from '../models.js';
import { localDateForHouse } from './job-lib.js';

function localNow(tz){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return Number(p.hour)*60+Number(p.minute);
}
function taskMinute(t){const [h,m]=String(t).split(':').map(Number);return h*60+m;}
await connectDB();
const houses=await House.find({active:true});let queued=0;
for(const house of houses){
  try{
    const date=localDateForHouse(house); const now=localNow(house.timezone || process.env.HOUSE_TIME_ZONE || 'Asia/Kolkata');
    const assignments=await Assignment.find({houseId:house._id,date,status:'pending'});
    const members=await Member.find({houseId:house._id,active:true}); const byId=new Map(members.map(m=>[m._id.toString(),m]));
    for(const a of assignments){ const delta=taskMinute(a.time)-now; if(delta<0||delta>15) continue; const member=byId.get(a.assignedToMemberId.toString()); if(!member)continue; await Notification.create({houseId:house._id,userId:member.userId,title:'Chore reminder ⏰',message:`${a.taskName} starts at ${a.time}.`,type:'reminder'}); if(process.env.WHATSAPP_ENABLED!=='true'||!member.phone)continue; const dedupeKey=`reminder:${house._id}:${a._id}:${date}`; const r=await MessageJob.updateOne({dedupeKey},{$setOnInsert:{houseId:house._id,memberId:member._id,type:'reminder',date,dedupeKey,status:'queued',payload:{memberName:member.name,houseName:house.name,tasks:[{name:a.taskName,time:a.time,icon:a.icon,effort:a.effort}],message:`${a.icon} ${a.taskName} starts at ${a.time}.`},nextAttemptAt:new Date()}},{upsert:true});if(r.upsertedCount)queued++; }
  }catch(e){console.error(`[reminder] ${house.name}:`,e.message);}
}
console.log(`[reminder] houses=${houses.length} queued=${queued}`); await closeDB();
