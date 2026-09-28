import mongoose from 'mongoose';

const { Schema } = mongoose;

const timestamps = { timestamps: true };

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, default: '' },
  email: { type: String, default: null, unique: true, sparse: true, lowercase: true, trim: true, maxlength: 320 },
  emailVerifiedAt: { type: Date, default: null },
  emailVerificationTokenHash: { type: String, default: null, index: true },
  emailVerificationExpiresAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  currentHouseId: { type: Schema.Types.ObjectId, ref: 'House', default: null, index: true },
  currentMemberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null, index: true },
  status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
  lastLoginAt: { type: Date, default: null },
  tokenVersion: { type: Number, default: 0 }
}, timestamps);

const houseSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  inviteCode: { type: String, required: true, unique: true, index: true, uppercase: true, trim: true },
  ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  capacity: { type: Number, default: 5, min: 2, max: 20 },
  maxTasksPerDay: { type: Number, default: 4, min: 1, max: 10 },
  morningCookCanCookLunch: { type: Boolean, default: true },
  waterMembersCount: { type: Number, default: 2, min: 1, max: 5 },
  roomCleaningMembersCount: { type: Number, default: 1, min: 1, max: 5 },
  autoReplacement: { type: Boolean, default: true },
  active: { type: Boolean, default: true }
}, timestamps);

const memberSchema = new Schema({
  houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, default: '' },
  role: { type: String, enum: ['ADMIN', 'MEMBER'], default: 'MEMBER', index: true },
  isCreator: { type: Boolean, default: false },
  avatar: { type: String, default: '', maxlength: 700000 },
  capabilities: { cook: { type: Boolean, default: true }, clean: { type: Boolean, default: true }, dishes: { type: Boolean, default: true }, water: { type: Boolean, default: true } },
  availability: { morning: { type: Boolean, default: true }, afternoon: { type: Boolean, default: true }, evening: { type: Boolean, default: true }, night: { type: Boolean, default: true } },
  preferred: { type: [String], default: [] },
  avoided: { type: [String], default: [] },
  tempAbsent: { start: String, end: String },
  joinedAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: true }
}, timestamps);
memberSchema.index({ houseId: 1, active: 1 });
memberSchema.index({ houseId: 1, phone: 1 });

const taskDefinitionSchema = new Schema({
  houseId: { type: Schema.Types.ObjectId, ref: 'House', default: null, index: true },
  key: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  time: { type: String, required: true },
  timeSlot: { type: String, required: true },
  effort: { type: Number, required: true, min: 1 },
  icon: { type: String, default: '⭐' },
  active: { type: Boolean, default: true }
}, timestamps);
taskDefinitionSchema.index({ houseId: 1, key: 1 }, { unique: true });

const scheduleSchema = new Schema({
  houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true },
  weekStart: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now },
  generatedBy: { type: String, enum: ['system', 'admin'], default: 'system' },
  version: { type: Number, default: 1 }
}, timestamps);
scheduleSchema.index({ houseId: 1, weekStart: 1 }, { unique: true });

const assignmentSchema = new Schema({
  houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true },
  scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', required: true, index: true },
  date: { type: String, required: true, index: true },
  taskId: { type: Schema.Types.ObjectId, ref: 'TaskDefinition', required: true },
  taskKey: { type: String, required: true },
  taskName: { type: String, required: true },
  category: { type: String, required: true },
  time: { type: String, required: true },
  timeSlot: { type: String, required: true },
  effort: { type: Number, required: true },
  icon: { type: String, default: '⭐' },
  assignedToMemberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  status: { type: String, enum: ['pending', 'completed', 'swapped', 'reassigned'], default: 'pending', index: true },
  completedAt: { type: Date, default: null },
  completedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  explanation: { type: String, default: '' }
}, timestamps);
assignmentSchema.index({ houseId: 1, date: 1, taskKey: 1 }, { unique: true });
assignmentSchema.index({ houseId: 1, assignedToMemberId: 1, date: 1 });

function genericHouseModel(name, fields) {
  const schema = new Schema({ houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true }, ...fields }, timestamps);
  schema.index({ houseId: 1, createdAt: -1 });
  return mongoose.model(name, schema);
}

const Expense = genericHouseModel('Expense', {
  title: { type: String, required: true }, amount: { type: Number, required: true, min: 0 }, category: { type: String, default: 'Other' }, date: { type: String, required: true }, paidByMemberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true }
});
const ExpenseArchive = genericHouseModel('ExpenseArchive', { monthKey: { type: String, required: true }, totalAmount: { type: Number, default: 0, min: 0 }, entryCount: { type: Number, default: 0, min: 0 }, categoryTotals: { type: Schema.Types.Mixed, default: {} }, memberTotals: { type: [Schema.Types.Mixed], default: [] }, closedAt: { type: Date, default: Date.now }, closedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null } });
ExpenseArchive.schema.index({ houseId: 1, monthKey: 1 }, { unique: true });
const Grocery = genericHouseModel('Grocery', { name: { type: String, required: true }, quantity: { type: String, default: '1' }, category: { type: String, default: 'General' }, status: { type: String, enum: ['open', 'bought'], default: 'open', index: true } });
const Meal = genericHouseModel('Meal', { date: { type: String, required: true }, mealType: { type: String, required: true }, menu: { type: String, required: true }, notes: { type: String, default: '' } });
Meal.schema.index({ houseId: 1, date: 1, mealType: 1 }, { unique: true });
const Announcement = genericHouseModel('Announcement', { title: { type: String, required: true }, message: { type: String, required: true }, createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true } });
const Maintenance = genericHouseModel('Maintenance', { title: { type: String, required: true }, description: { type: String, required: true }, priority: { type: String, enum: ['low','normal','high','urgent'], default: 'normal' }, status: { type: String, enum: ['open','in_progress','fixed'], default: 'open' }, reportedByMemberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true }, notes: { type: String, default: '' } });
const Inventory = genericHouseModel('Inventory', { name: { type: String, required: true }, category: { type: String, default: 'House' }, condition: { type: String, default: 'Good' }, warrantyUntil: { type: String, default: '' }, notes: { type: String, default: '' } });
const LeaveRequest = genericHouseModel('LeaveRequest', { memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true }, start: { type: String, required: true }, end: { type: String, required: true }, reason: { type: String, required: true }, status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' } });
const SwapRequest = genericHouseModel('SwapRequest', { taskId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true }, taskName: { type: String, required: true }, fromMemberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true }, toMemberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true }, status: { type: String, enum: ['pending','accepted','rejected'], default: 'pending' }, date: { type: String, required: true } });
const notificationSchema = new Schema({ houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, title: { type: String, required: true, maxlength: 140 }, message: { type: String, required: true, maxlength: 1000 }, type: { type: String, default: 'info', maxlength: 40 }, read: { type: Boolean, default: false, index: true }, dedupeKey: { type: String, default: null, unique: true, sparse: true, index: true } }, timestamps); notificationSchema.index({ houseId: 1, userId: 1, createdAt: -1 }); const Notification = mongoose.model('Notification', notificationSchema);
const AuditLog = genericHouseModel('AuditLog', { userId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, action: { type: String, required: true }, meta: { type: Schema.Types.Mixed, default: {} }, ip: { type: String, default: '' } });
const MessageJob = genericHouseModel('MessageJob', { memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true }, type: { type: String, enum: ['daily','reminder','announcement','test'], required: true, index: true }, date: { type: String, required: true, index: true }, dedupeKey: { type: String, required: true, unique: true, index: true }, payload: { type: Schema.Types.Mixed, default: {} }, status: { type: String, enum: ['queued','processing','sent','failed'], default: 'queued', index: true }, attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now, index: true }, lockedAt: { type: Date, default: null }, lastError: { type: String, default: '' }, providerMessageId: { type: String, default: '' }
}, timestamps);
MessageJob.schema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

const deviceTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true },
  token: { type: String, required: true, unique: true, index: true },
  platform: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now },
  userAgent: { type: String, default: '' }
}, timestamps);
deviceTokenSchema.index({ userId: 1, houseId: 1, active: 1 });

const pushJobSchema = new Schema({
  houseId: { type: Schema.Types.ObjectId, ref: 'House', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  type: { type: String, enum: ['daily', 'reminder', 'announcement', 'system', 'test'], required: true, index: true },
  date: { type: String, required: true, index: true },
  dedupeKey: { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true, maxlength: 140 },
  body: { type: String, required: true, maxlength: 1000 },
  data: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['queued', 'processing', 'sent', 'failed'], default: 'queued', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  providerMessageId: { type: String, default: '' }
}, timestamps);
pushJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

const MessageLog = genericHouseModel('MessageLog', { memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null, index: true }, type: { type: String, required: true }, date: { type: String, required: true, index: true }, phone: { type: String, default: '' }, success: { type: Boolean, required: true }, sid: { type: String, default: '' }, reason: { type: String, default: '' }, body: { type: String, default: '' } });
MessageLog.schema.index({ houseId: 1, date: 1, type: 1 });

// Every in-app notification becomes a push job when FCM is enabled.
// This keeps web/API instances stateless and lets one worker safely deliver pushes.
notificationSchema.post('save', async function(doc) {
  if (String(process.env.FCM_ENABLED || 'false').toLowerCase() !== 'true' || doc.type === 'delivery_error') return;
  try {
    const activeMember = await mongoose.model('Member').findOne({ houseId: doc.houseId, userId: doc.userId, active: true }).select('_id').lean();
    if (!activeMember) return;
    const PushJob = mongoose.model('PushJob');
    const key = `notification:${doc._id}`;
    await PushJob.updateOne(
      { dedupeKey: key },
      {
        $setOnInsert: {
          houseId: doc.houseId,
          userId: doc.userId,
          memberId: activeMember._id,
          type: doc.type === 'daily_task' ? 'daily' : (doc.type === 'announcement' ? 'announcement' : (doc.type === 'reminder' ? 'reminder' : 'system')),
          date: new Date().toISOString().slice(0, 10),
          dedupeKey: key,
          title: doc.title,
          body: doc.message,
          data: { notificationId: String(doc._id), url: '/' },
          status: 'queued',
          nextAttemptAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (error) {
    // Notification delivery should never break the primary request.
    console.error('[fcm-hook]', error?.message || error);
  }
});


export const User = mongoose.model('User', userSchema);
export const House = mongoose.model('House', houseSchema);
export const Member = mongoose.model('Member', memberSchema);
export const TaskDefinition = mongoose.model('TaskDefinition', taskDefinitionSchema);
export const Schedule = mongoose.model('Schedule', scheduleSchema);
export const Assignment = mongoose.model('Assignment', assignmentSchema);
export { Expense, ExpenseArchive, Grocery, Meal, Announcement, Maintenance, Inventory, LeaveRequest, SwapRequest, Notification, AuditLog, MessageJob, MessageLog };
export const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);
export const PushJob = mongoose.model('PushJob', pushJobSchema);
