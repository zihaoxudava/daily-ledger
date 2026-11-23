import { defaultGroups, defaultCategories, defaultAccounts, debtDirections, accountTypes, frequencies, tobaccoCategory } from './catalog.js';
import { occurrence } from './schedule.js';

export const MAX_AMOUNT = 9_999_999_999;
const DB = 'daily-ledger';
const STORE = 'book';
const KEY = 'ledger';
const MAX_CATEGORIES = 2000;
let opening;

export const initial = () => ({
  version:1, groups:structuredClone(defaultGroups), categories:structuredClone(defaultCategories),
  accounts:structuredClone(defaultAccounts), entries:[], budgets:[], rules:[], debts:[],
});

function withDefaults(book) {
  if (book.debts===undefined) book={...book,debts:[]};
  if (!Array.isArray(book.categories) || !Array.isArray(book.groups) || book.categories.length>=MAX_CATEGORIES) return book;
  const expenseGroups=new Set(book.groups.filter(group=>group?.type==='expense').map(group=>group.id));
  const alreadyPresent=book.categories.some(category=>category?.id===tobaccoCategory.id ||
    category?.name===tobaccoCategory.name && expenseGroups.has(category.group));
  if (expenseGroups.has(tobaccoCategory.group) && !alreadyPresent) {
    return {...book,categories:[...book.categories,{...tobaccoCategory}]};
  }
  return book;
}
export const debtOf = (book,id) => book.debts.find(item=>item.id===id);
export const debtRepaid = debt => debt.payments.reduce((sum,payment)=>sum+payment.amount,0);
export const debtRemaining = debt => debt.amount-debtRepaid(debt);

export function today() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth()+1, d.getDate()].map(v => String(v).padStart(2,'0')).join('-');
}

export function shiftMonth(iso, delta) {
  const [year, month] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0,7);
}

const formatMoney = new Intl.NumberFormat('zh-CN', {style:'currency', currency:'CNY'});
export const money = cents => formatMoney.format(cents / 100);

export function parseMoney(value, signed = false) {
  const clean = String(value).trim().replace(/^[¥￥]\s*/, '').replaceAll(',','');
  if (!(signed ? /^-?\d{1,8}(\.\d{1,2})?$/ : /^\d{1,8}(\.\d{1,2})?$/).test(clean)) {
    throw new Error('金额请填数字，最多保留两位小数。');
  }
  const [integer, fraction=''] = clean.replace(/^-/, '').split('.');
  const cents = (Number(integer) * 100 + Number(fraction.padEnd(2, '0'))) * (clean.startsWith('-') ? -1 : 1);
  if (!validAmount(cents, signed)) throw new Error(signed ? '期初余额超出可记账范围。' : '金额必须大于零。');
  return cents;
}

export const uid = () => crypto.randomUUID();
export const groupOf = (book, id) => book.groups.find(item => item.id === id);
export const categoryOf = (book, id) => book.categories.find(item => item.id === id);
export const accountOf = (book, id) => book.accounts.find(item => item.id === id);
export const categoryLabel = (book, id) => {
  const category = categoryOf(book, id);
  return category ? `${groupOf(book, category.group).name} · ${category.name}` : '';
};
export const validDate = date => typeof date === 'string' && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
export const validMonth = month => typeof month === 'string' && validDate(`${month}-01`);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const validAmount = (cents, signed = false) => Number.isSafeInteger(cents) && Math.abs(cents) <= MAX_AMOUNT && (signed || cents > 0);
const validText = (value, max, allowEmpty = false) => typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0);

function indexList(items, predicate, limit) {
  if (!Array.isArray(items) || items.length > limit) throw new Error('备份内容缺失或超过容量限制。');
  const map = new Map();
  for (const item of items) {
    if (!item || !validId(item.id) || map.has(item.id) || !predicate(item)) throw new Error('备份含重复编号、无效字段或失效的引用。');
    map.set(item.id, item);
  }
  return map;
}

export function validate(book) {
  if (!book || book.version !== 1) throw new Error('请选择日常账本格式的 JSON 备份。');
  book=withDefaults(book);
  const groups = indexList(book.groups, group => ['expense','income'].includes(group.type) && validText(group.name,28) && validText(group.icon,12), 300);
  const categories = indexList(book.categories, cat => groups.has(cat.group) && validText(cat.name,28) && typeof cat.archived === 'boolean', MAX_CATEGORIES);
  const accounts = indexList(book.accounts, acc => Object.hasOwn(accountTypes, acc.type) && validText(acc.name,28) && validAmount(acc.opening, true) && typeof acc.archived === 'boolean', 300);
  const matches = (cat, type) => categories.has(cat) && groups.get(categories.get(cat).group).type === (type === 'income' ? 'income' : 'expense');
  if (!book.accounts.some(acc => !acc.archived) || !groups.size) throw new Error('备份需要至少一个使用中的账户和分类组。');
  indexList(book.entries, entry => validAmount(entry.amount) && validDate(entry.date) && accounts.has(entry.account) && validText(entry.note,160,true) &&
    (entry.type === 'transfer' ? accounts.has(entry.to) && entry.to !== entry.account && entry.category === '' :
      ['expense','income','refund'].includes(entry.type) && matches(entry.category, entry.type) && entry.to === ''),
  60000);
  const budgetKeys = new Set();
  indexList(book.budgets, b => {
    const key = `${b.month}:${b.group}`;
    if (budgetKeys.has(key) || !validMonth(b.month) || !validAmount(b.amount) ||
      (b.group !== '' && groups.get(b.group)?.type !== 'expense')) return false;
    budgetKeys.add(key);
    return true;
  }, 6000);
  indexList(book.rules, r => r.id.length <= 80 && validText(r.name,60) && ['expense','income'].includes(r.type) && validAmount(r.amount) &&
    validDate(r.start) && (!r.end || validDate(r.end) && r.end >= r.start) && accounts.has(r.account) && matches(r.category,r.type) &&
    Object.hasOwn(frequencies, r.frequency) && Number.isSafeInteger(r.next) && r.next >= 0 && r.next < 5400 && typeof r.paused === 'boolean' &&
    (r.count === null || Number.isInteger(r.count) && r.count > 0 && r.count <= 600), 500);
  indexList(book.debts, debt=>{
    if (!Object.hasOwn(debtDirections,debt.direction) || !validText(debt.person,40) ||
      !validAmount(debt.amount) || !validDate(debt.date) || !validText(debt.note,160,true)) return false;
    indexList(debt.payments,payment=>validAmount(payment.amount) && validDate(payment.date) &&
      payment.date>=debt.date && validText(payment.note,160,true),60000);
    return debtRemaining(debt)>=0;
  },60000);
  return book;
}

function connect() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          opening = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请关闭其他打开的日常账本页面后重试。'));
    }).catch(error => { opening = undefined; throw error; });
  }
  return opening;
}

export async function readBook() {
  const database = await connect();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(withDefaults(request.result ?? initial()));
    request.onerror = () => reject(request.error);
  });
}

export async function writeBook(change) {
  const database = await connect();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE,'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(KEY);
    let result, error;
    request.onsuccess = () => {
      try {
        const current = withDefaults(request.result ?? initial());
        result = validate(change(current) ?? current);
        store.put(result, KEY);
      } catch (cause) {
        error = cause;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(error ?? transaction.error ?? new Error('保存中断，请重试。'));
  });
}

export function applyRecurring(book, date) {
  const recorded = new Set(book.entries.map(entry => entry.id));
  for (const rule of book.rules) {
    if (rule.paused) continue;
    while (rule.count === null || rule.next < rule.count) {
      const due = occurrence(rule, rule.next);
      if (due > date || (rule.end && due > rule.end)) break;
      const id = `${rule.id}_${due}`;
      if (!recorded.has(id)) {
        const note = rule.count === null ? rule.name : `${rule.name}（${rule.next+1}/${rule.count}）`;
        book.entries.push({id, date:due, type:rule.type, amount:rule.amount, account:rule.account, to:'', category:rule.category, note});
        recorded.add(id);
      }
      rule.next++;
    }
  }
}

export function totals(entries) {
  let income=0, expense=0;
  for (const entry of entries) {
    if (entry.type === 'income') income += entry.amount;
    if (entry.type === 'expense') expense += entry.amount;
    if (entry.type === 'refund') expense -= entry.amount;
  }
  return {income, expense, net:income-expense};
}

export function balances(book, date) {
  const result = new Map(book.accounts.map(account => [account.id, account.opening]));
  for (const entry of book.entries) {
    if (entry.date > date) continue;
    const signed = ['income','refund'].includes(entry.type) ? entry.amount : -entry.amount;
    result.set(entry.account, result.get(entry.account) + signed);
    if (entry.type === 'transfer') result.set(entry.to, result.get(entry.to) + entry.amount);
  }
  return result;
}

export function spending(book, entries) {
  const byGroup = new Map();
  const categories = new Map(book.categories.map(cat => [cat.id, cat.group]));
  for (const entry of entries) {
    if (entry.type !== 'expense' && entry.type !== 'refund') continue;
    const group = categories.get(entry.category);
    const amount = entry.type === 'expense' ? entry.amount : -entry.amount;
    byGroup.set(group, (byGroup.get(group) ?? 0) + amount);
  }
  return byGroup;
}
