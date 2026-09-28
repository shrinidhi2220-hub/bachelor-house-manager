import 'dotenv/config';
import { connectDB, closeDB } from '../db.js';
import { House } from '../models.js';
import { localDateForHouse, generateWeekForHouse, queueDailyJobsForHouse, archivePreviousExpenseMonth } from './job-lib.js';

function currentLocalParts(tz) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).map(x=>[x.type,x.value]));
}
function due(house){
  const tz=house.timezone || process.env.HOUSE_TIME_ZONE || 'Asia/Kolkata';
  const p=currentLocalParts(tz);
  const currentMinutes=Number(p.hour)*60+Number(p.minute); const targetMinutes=Number(process.env.DAILY_GENERATE_HOUR ?? 6)*60+Number(process.env.DAILY_GENERATE_MINUTE ?? 0); const delta=(currentMinutes-targetMinutes+1440)%1440; return delta >= 0 && delta < 15;
}

await connectDB();
const houses = await House.find({active:true});
let generated=0,queued=0,skipped=0;
for(const house of houses){
  if(!due(house)){skipped++;continue;}
  try{await archivePreviousExpenseMonth(house);const w=await generateWeekForHouse(house,'system',false);if(w.created)generated++;const q=await queueDailyJobsForHouse(house,localDateForHouse(house));queued+=q.queued;}
  catch(e){console.error(`[cron] ${house.name}:`,e.message);}
}
console.log(`[cron] houses=${houses.length} due=${houses.length-skipped} newWeeks=${generated} queuedMessages=${queued}`);
await closeDB();
