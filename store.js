import { defaultGroups, defaultCategories, defaultAccounts, debtDirections, accountTypes, frequencies, tobaccoCategory } from './catalog.js';
import { occurrence } from './schedule.js';
import { attachmentIndex, requireAttachment } from './attachments.js';
import { android, readNativeBook, writeNativeBook, readNativeAttachment } from './native.js';

export const MAX_AMOUNT = 9_999_999_999;
const DB = 'daily-ledger';
const STORE = 'book';
const KEY = 'ledger';
const attachmentKey = id => `attachment:${id}`;
const MAX_CATEGORIES = 2000;
let opening;
let nativeWrite=Promise.resolve();

export const initial = () => ({
  version:1, groups:structuredClone(defaultGroups), categories:structuredClone(defaultCategories),
  accounts:structuredClone(defaultAccounts), entries:[], budgets:[], rules:[], debts:[],
  savings:[], savingDeposits:[],
});

export const ledgerStyles = ['jade','ocean','orchid','sand','rose','slate'];
export const ledgerIcons = ['wallet','reports','overview','guide','plan','savings'];
export const wallpaperPages = ['overview','records','reports','report-detail','plan','debts','settings',
  'accounts','categories','files','updates','months','savings','saving-detail','ledgers','appearance','auto'];
export const wallpaperVideos = ['video/mp4','video/webm','video/quicktime'];
export const wallpaperImages = ['image/jpeg','image/png','image/gif','image/webp','image/avif','image/bmp','image/heic','image/heif'];
export const defaultWallpaperTransparency = 25;
export const ledgerFor = (root,id) => root.ledgers?.find(item=>item.id===id)?.data ?? root;
export function wallpaperFor(root,page) {
  const walls=root?.wallpapers;
  const wall=walls?.[page];
  if (wall?.system) return undefined;
  if (wall?.media || wall?.color || page==='overview') return wall;
  const overview=walls?.overview;
  if (overview && wall?.positionX!==undefined) return {...overview,
    fit:wall.fit,position:wall.position,positionX:wall.positionX,shade:wall.shade,transparency:wall.transparency};
  if (overview && wall?.transparency!==undefined) return {...overview,transparency:wall.transparency};
  return overview;
}

function withDefaults(book) {
  if (book.debts===undefined) book={...book,debts:[]};
  if (book.savings===undefined) book={...book,savings:[]};
  if (book.savingDeposits===undefined) book={...book,savingDeposits:[]};
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
export const savingOf = (book,id) => book.savings.find(plan=>plan.id===id);
const dayMs=86_400_000;
const dayStamp=date=>Date.parse(`${date}T00:00:00Z`);

function scheduledSaving(plan,date) {
  const end=plan.end && plan.end<date ? plan.end : date;
  return end<plan.start ? 0 : (Math.round((dayStamp(end)-dayStamp(plan.start))/dayMs)+1)*plan.daily;
}

export function savingTotals(plan,deposits,date) {
  const due=scheduledSaving(plan,date);
  const actual=deposits.reduce((sum,item)=>sum+(item.date<=date?item.amount:0),0);
  const todayDue=date>=plan.start && (!plan.end || date<=plan.end) ? plan.daily : 0;
  return {todayDue,due,actual,pending:Math.max(0,due-actual)};
}

export function savingCalendar(plan,deposits,date,limit) {
  const amounts=new Map();
  let end=plan.end && plan.end<date ? plan.end : date;
  let actual=0;
  for (const item of deposits) {
    if (item.date>date) continue;
    amounts.set(item.date,(amounts.get(item.date) ?? 0)+item.amount);
    actual+=item.amount;
    if (item.date>end) end=item.date;
  }
  const days=[];
  const start=dayStamp(plan.start);
  let mark=dayStamp(end);
  while (mark>=start && days.length<limit) {
    const date=new Date(mark).toISOString().slice(0,10);
    const deposited=amounts.get(date) ?? 0;
    days.push({date,deposited,due:!plan.end || date<=plan.end?plan.daily:0,
      pending:Math.max(0,scheduledSaving(plan,date)-actual)});
    actual-=deposited;
    mark-=dayMs;
  }
  return {days,more:mark>=start};
}

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
export const validTime = time => time === undefined || time === '' ||
  typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export const newestFirst = (a,b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? '');
export const dateAndTime = ({date,time}) => time ? `${date} ${time}` : date;
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
  book=validateLedger(book);
  const ledgers=indexList(book.ledgers ?? [],item=>item.id!=='main' && validText(item.name,28) &&
    validText(item.description,100,true) && ledgerStyles.includes(item.style) && ledgerIcons.includes(item.icon),20);
  for (const item of ledgers.values()) {
    if (item.data?.ledgers!==undefined || item.data?.wallpapers!==undefined || item.data?.autoCapture!==undefined) {
      throw new Error('独立账本结构无效。');
    }
    item.data=validateLedger(item.data);
  }
  const wallpapers=book.wallpapers ?? {};
  if (typeof wallpapers!=='object' || Array.isArray(wallpapers) ||
      Object.entries(wallpapers).some(([page,wall])=>!wallpaperPages.includes(page) || !wall ||
        (wall.system!==undefined && (wall.system!==true || page==='overview' || wall.color || wall.media!==undefined || wall.transparency!==undefined)) ||
        !(wall.color==='' || /^#[a-fA-F0-9]{6}$/.test(wall.color)) ||
        !Number.isInteger(wall.shade) || wall.shade<0 || wall.shade>85 || !['cover','contain'].includes(wall.fit) ||
        !['center','top','bottom'].includes(wall.position) ||
        (wall.positionX!==undefined && !['left','center','right'].includes(wall.positionX)) ||
        (wall.transparency!==undefined && (!Number.isInteger(wall.transparency) || wall.transparency<0 || wall.transparency>100)) ||
        (wall.media!==undefined && ![...wallpaperVideos,...wallpaperImages].includes(wall.media?.type)))) {
    throw new Error('页面背景设置无效。');
  }
  if (book.autoCapture!==undefined) {
    const config=book.autoCapture;
    if (!config || typeof config.enabled!=='boolean' || !['main',...ledgers.keys()].includes(config.ledger) ||
        !['wechat','alipay'].every(source=>typeof config[source]==='string' && (config[source]==='' || validId(config[source])))) {
      throw new Error('自动记账设置无效。');
    }
  }
  return book;
}

function validateLedger(book) {
  if (!book || book.version !== 1) throw new Error('请选择日常账本格式的 JSON 备份。');
  book=withDefaults(book);
  const groups = indexList(book.groups, group => ['expense','income'].includes(group.type) && validText(group.name,28) && validText(group.icon,12), 300);
  const categories = indexList(book.categories, cat => groups.has(cat.group) && validText(cat.name,28) && typeof cat.archived === 'boolean', MAX_CATEGORIES);
  const accounts = indexList(book.accounts, acc => Object.hasOwn(accountTypes, acc.type) && validText(acc.name,28) && validAmount(acc.opening, true) && typeof acc.archived === 'boolean', 300);
  const matches = (cat, type) => categories.has(cat) && groups.get(categories.get(cat).group).type === (type === 'income' ? 'income' : 'expense');
  if (!book.accounts.some(acc => !acc.archived) || !groups.size) throw new Error('备份需要至少一个使用中的账户和分类组。');
  indexList(book.entries, entry => validAmount(entry.amount) && validDate(entry.date) && validTime(entry.time) && accounts.has(entry.account) && validText(entry.note,160,true) &&
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
  const savings=indexList(book.savings, plan=>validText(plan.name,40) && validAmount(plan.daily) &&
    validDate(plan.start) && (plan.end==='' || validDate(plan.end) && plan.end>=plan.start),20);
  indexList(book.savingDeposits, item=>savings.has(item.plan) && validDate(item.date) &&
    item.date>=savings.get(item.plan).start && validAmount(item.amount) && validText(item.note,160,true),60000);
  indexList(book.rules, r => r.id.length <= 80 && validText(r.name,60) && ['expense','income'].includes(r.type) && validAmount(r.amount) &&
    validDate(r.start) && (!r.end || validDate(r.end) && r.end >= r.start) && accounts.has(r.account) && matches(r.category,r.type) &&
    Object.hasOwn(frequencies, r.frequency) && Number.isSafeInteger(r.next) && r.next >= 0 && r.next < 5400 && typeof r.paused === 'boolean' &&
    (r.count === null || Number.isInteger(r.count) && r.count > 0 && r.count <= 600), 500);
  indexList(book.debts, debt=>{
    if (!Object.hasOwn(debtDirections,debt.direction) || !validText(debt.person,40) ||
      !validAmount(debt.amount) || !validDate(debt.date) || !validTime(debt.time) || !validText(debt.note,160,true)) return false;
    if (debt.reminder!==undefined && (!debt.reminder || !validDate(debt.reminder.date) ||
      !debt.reminder.time || !validTime(debt.reminder.time))) return false;
    indexList(debt.payments,payment=>validAmount(payment.amount) && validDate(payment.date) && validTime(payment.time) &&
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
  if (android) return withDefaults(readNativeBook() ?? initial());
  const database = await connect();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(withDefaults(request.result ?? initial()));
    request.onerror = () => reject(request.error);
  });
}

export async function readAttachment(item) {
  if (android) return readNativeAttachment(item);
  const database=await connect();
  return new Promise((resolve,reject)=>{
    const request=database.transaction(STORE).objectStore(STORE).get(attachmentKey(item.id));
    request.onsuccess=()=>{
      try { resolve(new Blob([requireAttachment(request.result,item)],{type:item.type})); }
      catch (error) { reject(error); }
    };
    request.onerror=()=>reject(request.error);
  });
}

export async function readBackup() {
  if (android) {
    const snapshot=nativeWrite.then(async()=>{
      const book=await readBook();
      const files=new Map();
      for (const [id,item] of attachmentIndex(book)) files.set(id,await readNativeAttachment(item));
      return {book,files};
    });
    nativeWrite=snapshot.catch(()=>{});
    return snapshot;
  }
  const database=await connect();
  return new Promise((resolve,reject)=>{
    const transaction=database.transaction(STORE);
    const store=transaction.objectStore(STORE);
    const request=store.get(KEY);
    const files=new Map();
    let book;
    let error;
    request.onsuccess=()=>{
      try {
        book=withDefaults(request.result ?? initial());
        for (const [id,item] of attachmentIndex(book)) {
          const attachment=store.get(attachmentKey(id));
          attachment.onsuccess=()=>{
            try { files.set(id,new Blob([requireAttachment(attachment.result,item)],{type:item.type})); }
            catch (cause) { error=cause; transaction.abort(); }
          };
        }
      } catch (cause) { error=cause; transaction.abort(); }
    };
    transaction.oncomplete=()=>resolve({book,files});
    transaction.onabort=()=>reject(error ?? transaction.error ?? new Error('读取备份中断，请重试。'));
  });
}

export async function writeBook(change,files=new Map()) {
  if (android) {
    const write=nativeWrite.then(async()=>{
      const current=await readBook();
      const next=validate(change(current) ?? current);
      await writeNativeBook(next,attachmentIndex(next),files);
      return next;
    });
    nativeWrite=write.catch(()=>{});
    return write;
  }
  const buffers=new Map();
  for (const [id,file] of files) buffers.set(id,file instanceof Blob ? await file.arrayBuffer() : file);
  const database = await connect();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE,'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(KEY);
    let result, error;
    request.onsuccess = () => {
      try {
        const current = withDefaults(request.result ?? initial());
        const before = attachmentIndex(current);
        result = validate(change(current) ?? current);
        const after = attachmentIndex(result);
        for (const [id,item] of after) {
          if (buffers.has(id) || !before.has(id)) {
            store.put(requireAttachment(buffers.get(id),item),attachmentKey(id));
          }
        }
        for (const id of before.keys()) {
          if (!after.has(id)) store.delete(attachmentKey(id));
        }
        store.put(result, KEY);
      } catch (cause) {
        error = cause;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => {
      const cause=error ?? transaction.error;
      reject(cause?.name==='QuotaExceededError' ? new Error('本机空间不足，请移除附件或释放存储后重试。') :
        cause ?? new Error('保存中断，请重试。'));
    };
  });
}

function nextDue(rule, through) {
  if (rule.paused || (rule.count !== null && rule.next >= rule.count)) return;
  const date = occurrence(rule, rule.next);
  if (date <= through && (!rule.end || date <= rule.end)) return date;
}

export const hasDueRecurring = (book,date) => book.rules.some(rule => nextDue(rule,date));

export function applyRecurring(book, date) {
  const recorded = new Set(book.entries.map(entry => entry.id));
  for (const rule of book.rules) {
    let due;
    while ((due = nextDue(rule,date))) {
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
