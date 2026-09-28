import 'dotenv/config';
import { connectDB, mongoose } from './db.js';

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DB_RESET !== 'true') {
  console.error('Refusing to reset. Set ALLOW_DB_RESET=true in a non-production environment.');
  process.exit(1);
}
await connectDB();
await mongoose.connection.dropDatabase();
console.log('Development database reset complete. Next user can create a new house.');
await mongoose.disconnect();
