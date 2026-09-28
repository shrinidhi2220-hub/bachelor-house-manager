import { MessageJob, Notification, Member, Assignment, House, Schedule } from '../models.js';
import { BASE_TASKS, addDays, weekStart, dayName, chooseMember } from '../schedule-engine.js';

export function localDateForHouse(house, now = new Date()) {
  const tz=house.timezone || process.env.HOUSE_TIME_ZONE || 'Asia/Kolkata';
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function previousMonthKey(monthKey) { const [y,m]=String(monthKey).split('-').map(Number); const d=new Date(Date.UTC(y,m-2,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; }
export async function archiveExpenseMonth(house, month, userId=null) {
  const existing=await ExpenseArchive.findOne({houseId:house._id,monthKey:month}); if(existing)return existing;
  const [y,m]=month.split('-').map(Number); const start=`${month}-01`; const d=new Date(Date.UTC(y,m,1)); const next=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`;
  const expenses=await Expense.find({houseId:house._id,date:{$gte:start,$lt:next}}).lean(); const members=await Member.find({houseId:house._id}).select('_id name').lean(); const names=new Map(members.map(m=>[m._id.toString(),m.name]));
  const categoryTotals={}; const memberMap=new Map(); let totalAmount=0;
  for(const e of expenses){const amount=Number(e.amount||0);totalAmount+=amount;const cat=e.category||'Other';categoryTotals[cat]=(categoryTotals[cat]||0)+amount;const key=e.paidByMemberId.toString();const item=memberMap.get(key)||{memberId:key,memberName:names.get(key)||'Former member',amount:0,entries:0};item.amount+=amount;item.entries++;memberMap.set(key,item);}
  try{return await ExpenseArchive.create({houseId:house._id,monthKey:month,totalAmount,entryCount:expenses.length,categoryTotals,memberTotals:[...memberMap.values()],closedByUserId:userId});}catch(e){if(e?.code===11000)return ExpenseArchive.findOne({houseId:house._id,monthKey:month});throw e;}
}
export async function archivePreviousExpenseMonth(house) { const current=localDateForHouse(house).slice(0,7); const previous=previousMonthKey(current); if(previous) await archiveExpenseMonth(house,previous,null); }
export function assignmentPublic(a) { return { id:a._id.toString(),houseId:a.houseId.toString(),scheduleId:a.scheduleId.toString(),date:a.date,taskId:a.taskId.toString(),taskKey:a.taskKey,taskName:a.taskName,category:a.category,time:a.time,timeSlot:a.timeSlot,effort:a.effort,icon:a.icon,assignedToMemberId:a.assignedToMemberId.toString(),status:a.status,completedAt:a.completedAt,completedByUserId:a.completedByUserId?.toString()||null,explanation:a.explanation||'' }; }
export async function generateWeekForHouse(house, generatedBy='system', force=false) {
  const start=weekStart(localDateForHouse(house));
  if(!force){ const existing=await Schedule.findOne({houseId:house._id,weekStart:start}); if(existing)return {schedule:existing,created:false}; }
  if(force){ await Assignment.deleteMany({houseId:house._id,date:{$gte:start,$lte:addDays(start,6)}}); await Schedule.deleteMany({houseId:house._id,weekStart:start}); await MessageJob.deleteMany({houseId:house._id,date:{$gte:start,$lte:addDays(start,6)},type:'daily',status:{$in:['queued','failed']}}); }
  let schedule;
  try { schedule=await Schedule.create({houseId:house._id,weekStart:start,generatedBy,version:Date.now()}); }
  catch(e){ if(e?.code===11000){schedule=await Schedule.findOne({houseId:house._id,weekStart:start}); return {schedule,created:false};} throw e; }
  const members=await Member.find({houseId:house._id,active:true}); const tasks=await requireTasks(house._id); const history=await Assignment.find({houseId:house._id,date:{$gte:addDays(start,-7),$lt:start}}).lean(); const projected=[];
  for(let i=0;i<7;i++){const date=addDays(start,i);let water1=null;for(const task of tasks){const blocked=new Set();if(task.key==='water_set_2'&&water1)blocked.add(water1._id.toString());const chosen=chooseMember({members,task,date,history,projected,settings:house.toObject(),blockedIds:blocked});if(!chosen)continue;const item={houseId:house._id,scheduleId:schedule._id,date,taskId:task._id,taskKey:task.key,taskName:task.name,category:task.category,time:task.time,timeSlot:task.timeSlot,effort:task.effort,icon:task.icon,assignedToMemberId:chosen._id,status:'pending',explanation:'Balanced using availability, projected workload, 7-day history, preferences and recent-task rotation.'};projected.push(item);if(task.key==='water_set_1')water1=chosen;}}
  if(projected.length) await Assignment.insertMany(projected,{ordered:false});
  return {schedule,created:true};
}
async function requireTasks(houseId){
  const { TaskDefinition } = await import('../models.js');
  const existing=await TaskDefinition.find({houseId,active:true}).sort({time:1});
  if(existing.length)return existing;
  return TaskDefinition.insertMany(BASE_TASKS.map(t=>({houseId,...t,active:true})));
}
export async function queueDailyJobsForHouse(house,date){
  const assignments=await Assignment.find({houseId:house._id,date}).sort({time:1});if(!assignments.length)return {queued:0};
  const members=await Member.find({houseId:house._id,active:true});const grouped=new Map();for(const a of assignments){const k=a.assignedToMemberId.toString();if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(a);}let queued=0;
  for(const m of members){const list=grouped.get(m._id.toString())||[];if(!list.length)continue;const notificationKey=`daily-notification:${house._id}:${m._id}:${date}`; await Notification.updateOne({dedupeKey:notificationKey},{$setOnInsert:{houseId:house._id,userId:m.userId,title:'Your house tasks are ready 🏠',message:list.map(a=>`${a.icon} ${a.taskName} at ${a.time}`).join(' • '),type:'daily_task',dedupeKey:notificationKey}},{upsert:true});if(!m.phone){continue;}const dedupeKey=`daily:${house._id}:${m._id}:${date}`;const r=await MessageJob.updateOne({dedupeKey},{$setOnInsert:{houseId:house._id,memberId:m._id,type:'daily',date,dedupeKey,status:'queued',payload:{memberName:m.name,houseName:house.name,tasks:list.map(a=>({name:a.taskName,time:a.time,icon:a.icon,effort:a.effort}))},nextAttemptAt:new Date()}},{upsert:true});if(r.upsertedCount)queued++;}
  return {queued};
}
