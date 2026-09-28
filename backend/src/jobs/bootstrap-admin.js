import 'dotenv/config';
import crypto from 'node:crypto';
import { connectDB, closeDB } from '../db.js';
import { User, House, Member, TaskDefinition } from '../models.js';
import { hashPassword, normalizeUsername, normalizePhone, validPhone } from '../security.js';
import { BASE_TASKS } from '../schedule-engine.js';

if (process.env.ADMIN_BOOTSTRAP_ENABLED !== 'true') { console.error('Set ADMIN_BOOTSTRAP_ENABLED=true first.'); process.exit(1); }
await connectDB();
const username=normalizeUsername(process.env.ADMIN_BOOTSTRAP_USERNAME || 'shreeshant');
const password=process.env.ADMIN_BOOTSTRAP_PASSWORD;
if(!password || password.length<8) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 8 characters.');
const name=(process.env.ADMIN_BOOTSTRAP_NAME||'SHREESHANT').trim();
const phone=normalizePhone(process.env.ADMIN_BOOTSTRAP_PHONE||'');if(phone&&!validPhone(phone))throw new Error('Invalid bootstrap phone.');
let user=await User.findOne({username});
if(!user) user=await User.create({username,passwordHash:await hashPassword(password),name,phone});
let house=await House.findOne({ownerUserId:user._id,active:true});
if(!house){house=await House.create({name:process.env.HOUSE_NAME||`${name}'s House`,inviteCode:`BH-${crypto.randomUUID().slice(0,8).toUpperCase()}`,ownerUserId:user._id,capacity:Number(process.env.DEFAULT_HOUSE_CAPACITY||5),maxTasksPerDay:Number(process.env.DEFAULT_MAX_TASKS_PER_DAY||4)});}
let member=await Member.findOne({houseId:house._id,userId:user._id});
if(!member)member=await Member.create({houseId:house._id,userId:user._id,name,phone,role:'ADMIN',isCreator:true});
user.currentHouseId=house._id;user.currentMemberId=member._id;await user.save();
if(!await TaskDefinition.exists({houseId:house._id}))await TaskDefinition.insertMany(BASE_TASKS.map(t=>({houseId:house._id,...t,active:true})));
console.log(`Admin ready: ${username}`);console.log(`House: ${house.name}`);console.log(`Invite code: ${house.inviteCode}`);
await closeDB();
