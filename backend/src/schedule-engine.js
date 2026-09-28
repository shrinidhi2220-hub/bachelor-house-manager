const BASE_TASKS = [
  { key: 'morning_breakfast', name: 'Morning Breakfast', category: 'Cooking', time: '07:30', timeSlot: 'morning', effort: 3, icon: '🍳' },
  { key: 'morning_dishes', name: 'Dish Washing — Morning', category: 'Kitchen', time: '08:30', timeSlot: 'morning', effort: 2, icon: '🍽️' },
  { key: 'water_set_1', name: 'Water Duty — Set 1', category: 'Water', time: '09:00', timeSlot: 'morning', effort: 2, icon: '🚰' },
  { key: 'water_set_2', name: 'Water Duty — Set 2', category: 'Water', time: '09:00', timeSlot: 'morning', effort: 2, icon: '💧' },
  { key: 'room_cleaning', name: 'Room Cleaning', category: 'Cleaning', time: '10:00', timeSlot: 'morning', effort: 3, icon: '🧹' },
  { key: 'afternoon_lunch', name: 'Afternoon Lunch', category: 'Cooking', time: '13:00', timeSlot: 'afternoon', effort: 4, icon: '🍛' },
  { key: 'afternoon_dishes', name: 'Dish Washing — Afternoon', category: 'Kitchen', time: '14:00', timeSlot: 'afternoon', effort: 2, icon: '🥣' },
  { key: 'evening_dinner', name: 'Evening Dinner', category: 'Cooking', time: '20:00', timeSlot: 'evening', effort: 4, icon: '🍲' },
  { key: 'evening_dishes', name: 'Dish Washing — Evening', category: 'Kitchen', time: '21:00', timeSlot: 'evening', effort: 2, icon: '🧼' },
  { key: 'kitchen_cleaning', name: 'Kitchen Cleaning', category: 'Kitchen', time: '21:30', timeSlot: 'evening', effort: 3, icon: '✨' },
  { key: 'garbage_disposal', name: 'Garbage Disposal', category: 'Other', time: '22:00', timeSlot: 'evening', effort: 1, icon: '🗑️' }
];

export { BASE_TASKS };

function pastDates(date, days) {
  const arr = [];
  for (let i = 1; i <= days; i++) arr.push(addDays(date, -i));
  return arr;
}
export function addDays(dateString, days) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(dateString) { const d = new Date(`${dateString}T12:00:00Z`); const day = d.getUTCDay(); const delta = day === 0 ? 6 : day - 1; d.setUTCDate(d.getUTCDate() - delta); return d.toISOString().slice(0,10); }
export function dayName(dateString) { return new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(`${dateString}T12:00:00Z`)); }

function available(member, task, date) {
  const a = member.availability || {};
  if (a[task.timeSlot] === false) return false;
  if (member.tempAbsent?.start && date >= member.tempAbsent.start && date <= member.tempAbsent.end) return false;
  if (task.category === 'Cooking' && !member.capabilities?.cook) return false;
  if (task.category === 'Cleaning' && !member.capabilities?.clean) return false;
  if (task.category === 'Water' && !member.capabilities?.water) return false;
  if (task.category === 'Kitchen' && !member.capabilities?.dishes) return false;
  return true;
}

export function chooseMember({ members, task, date, history, projected, settings, blockedIds = new Set() }) {
  const historyDates = new Set(pastDates(date, 7));
  const candidates = members.filter(m => m.active && !blockedIds.has(m._id.toString()) && available(m, task, date));
  if (!candidates.length) return null;

  const score = member => {
    const id = member._id.toString();
    const dayTasks = projected.filter(x => x.assignedToMemberId.toString() === id && x.date === date);
    const dayEffort = dayTasks.reduce((s,x)=>s+x.effort,0);
    const historical = history.filter(x => x.assignedToMemberId.toString() === id && historyDates.has(x.date)).reduce((s,x)=>s+x.effort,0);
    const repeated = history.some(x => x.assignedToMemberId.toString() === id && x.taskKey === task.key && historyDates.has(x.date));
    let v = dayEffort * 20 + historical * 4 + (repeated ? 45 : 0);
    if (dayTasks.length >= settings.maxTasksPerDay) v += 800;
    if ((member.preferred || []).some(p => p.toLowerCase().includes(task.category.toLowerCase()) || p.toLowerCase().includes(task.name.toLowerCase()))) v -= 30;
    if ((member.avoided || []).some(p => p.toLowerCase().includes(task.category.toLowerCase()) || p.toLowerCase().includes(task.name.toLowerCase()))) v += 40;
    if (task.key === 'afternoon_lunch' && settings.morningCookCanCookLunch) {
      const breakfast = projected.find(x => x.date === date && x.taskKey === 'morning_breakfast');
      if (breakfast?.assignedToMemberId?.toString() === id) v -= 25;
    }
    return { v, dayEffort, historical };
  };

  return candidates.map(m => ({ member:m, s:score(m) })).sort((a,b)=>a.s.v-b.s.v || a.s.historical-b.s.historical || String(a.member._id).localeCompare(String(b.member._id)))[0].member;
}
