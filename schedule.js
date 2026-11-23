// Month-end and recurrence arithmetic adapted from Moniflow, MIT.
// Source and copyright are recorded in THIRD-PARTY.txt.
const pad = value => String(value).padStart(2, '0');

export function clampDay(year, month, day) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth))}`;
}

export function occurrence(rule, index) {
  const [year, month, day] = rule.start.split('-').map(Number);
  if (rule.frequency === 'weekly') {
    return new Date(Date.UTC(year, month - 1, day + index * 7)).toISOString().slice(0, 10);
  }
  const offset = year * 12 + month - 1 + index * (rule.frequency === 'yearly' ? 12 : 1);
  return clampDay(Math.floor(offset / 12), offset % 12 + 1, day);
}

export function firstAfter(rule, date) {
  if (date < rule.start) return 0;
  if (rule.frequency === 'weekly') {
    return Math.floor((Date.parse(date) - Date.parse(rule.start)) / (7 * 86400000)) + 1;
  }
  const [year, month] = date.split('-').map(Number);
  const [startYear, startMonth] = rule.start.split('-').map(Number);
  const interval = rule.frequency === 'yearly' ? 12 : 1;
  const index = Math.floor(((year - startYear) * 12 + month - startMonth) / interval);
  return occurrence(rule, index) <= date ? index + 1 : index;
}
