import 'dotenv/config';
import { connectDB, closeDB } from '../db.js';
import '../models.js';
await connectDB();
for (const name of ['User','House','Member','TaskDefinition','Schedule','Assignment','Expense','ExpenseArchive','Grocery','Meal','Announcement','Maintenance','Inventory','LeaveRequest','SwapRequest','Notification','AuditLog','MessageJob','MessageLog','DeviceToken','PushJob']) {
  const mongoose = await import('mongoose');
  const Model = mongoose.model(name);
  await Model.syncIndexes();
  console.log(`${name}: indexes synced`);
}
await closeDB();
