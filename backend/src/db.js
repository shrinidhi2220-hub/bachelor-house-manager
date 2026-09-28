import mongoose from 'mongoose';

let connected = false;

export async function connectDB() {
  if (connected && mongoose.connection.readyState === 1) return mongoose.connection;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required.');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 30),
    minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 5),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000)
  });
  connected = true;
  return mongoose.connection;
}

export async function closeDB() {
  connected = false;
  await mongoose.disconnect();
}

export { mongoose };
