import { User, House, Member, TaskDefinition, Schedule, Assignment, ExpenseArchive, DeviceToken, PushJob } from '../models.js';

const models = { User, House, Member, TaskDefinition, Schedule, Assignment, ExpenseArchive, DeviceToken, PushJob };
for (const [name, model] of Object.entries(models)) {
  if (!model.schema.path('createdAt') || !model.schema.path('updatedAt')) {
    throw new Error(`${name} schema is missing Mongoose timestamps.`);
  }
}

console.log('Mongoose schema check passed.');
for (const [name, model] of Object.entries(models)) {
  console.log(`${name}: createdAt=${model.schema.path('createdAt').instance}, updatedAt=${model.schema.path('updatedAt').instance}`);
}
