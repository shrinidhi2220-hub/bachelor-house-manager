import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export function normalizeUsername(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ''); }
export function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
export function validEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
export function normalizePhone(value) {
  const raw = String(value || '').trim().replace(/[\s()-]/g, '');
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  if (raw.startsWith('00')) return `+${raw.slice(2)}`;
  if (/^\d{10}$/.test(raw)) return `+91${raw}`;
  return `+${raw}`;
}
export function validPhone(phone) { return !phone || /^\+[1-9]\d{7,14}$/.test(phone); }
export async function hashPassword(password) { return bcrypt.hash(String(password), 12); }
export async function verifyPassword(password, hash) { return bcrypt.compare(String(password), hash); }
export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), houseId: user.currentHouseId?.toString() || null, memberId: user.currentMemberId?.toString() || null, role: user.role || undefined, tv: Number(user.tokenVersion || 0) }, process.env.TOKEN_SECRET, { expiresIn: process.env.TOKEN_TTL || '7d', issuer: 'bachelor-house-manager' });
}
export function publicUser(user, member = null) {
  return { id: user._id.toString(), username: user.username, name: user.name, role: member?.role || 'MEMBER', houseId: user.currentHouseId?.toString() || null, memberId: user.currentMemberId?.toString() || null, phone: member?.phone || user.phone || '', email: user.email || '', emailVerified: Boolean(user.emailVerifiedAt), emailVerifiedAt: user.emailVerifiedAt || null, avatar: member?.avatar || '' };
}
