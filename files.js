import { types } from './catalog.js';
import { categoryOf, groupOf, accountOf, parseMoney, uid, validDate, validTime } from './store.js';

const headers = ['日期','类型','金额','账户','转入账户','分类组','分类','备注','记录编号','时间'];
const byName = Object.fromEntries(Object.entries(types).map(([type,label]) => [label,type]));
const protect = value => /^[\s]*[=+\-@]|^[\t\r\n]|^'/.test(value) ? "'" + value : value;
const unprotect = value => value.startsWith("'") && protect(value.slice(1)) === value ? value.slice(1) : value;
const quote = value => '"' + protect(String(value)).replaceAll('"','""') + '"';

export function exportCSV(book, entries = book.entries) {
  const rows = entries.map(entry => {
    const category = categoryOf(book, entry.category);
    return [
      entry.date, types[entry.type], (entry.amount / 100).toFixed(2), accountOf(book, entry.account).name,
      accountOf(book, entry.to)?.name ?? '', category ? groupOf(book, category.group).name : '',
      category?.name ?? '', entry.note, entry.id, entry.time ?? '',
    ];
  });
  return '\uFEFF' + [headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
}

export const csvTemplate = () => '\uFEFF' + headers.join(',') + '\r\n';

function parseCSV(raw) {
  const input = raw.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  const nextCell = () => { row.push(unprotect(cell)); cell=''; closed=false; };
  const nextRow = () => { nextCell(); rows.push(row); row=[]; };
  for (let index=0; index<input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index+1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted=false; closed=true; }
      else cell += char;
    } else if (char === '"' && !cell && !closed) {
      quoted = true;
    } else if (char === ',') {
      nextCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index+1] === '\n') index++;
      nextRow();
    } else if (closed || char === '"') {
      throw new Error('CSV 引号或分隔符有误。请使用 UTF-8 逗号分隔格式。');
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV 有未闭合的引号。');
  if (cell || row.length || closed) nextRow();
  return rows;
}

function findOrAdd(list, predicate, fields) {
  let item = list.find(predicate);
  if (!item) {
    item = { id:uid(), ...fields };
    list.push(item);
  }
  return item.id;
}

export function importCSV(book, raw) {
  const [header, ...rows] = parseCSV(raw);
  const names = header?.map(cell => cell.trim()) ?? [];
  if (!headers.slice(0,8).every(col => names.includes(col)) || new Set(names).size !== names.length) {
    throw new Error('表头不匹配，请先下载 CSV 模板，保留原有列名。');
  }
  const ids = new Set(book.entries.map(entry => entry.id));
  let added=0, skipped=0;
  rows.forEach((row,index) => {
    if (row.every(cell => !cell.trim())) return;
    try {
      if (row.length !== names.length) throw new Error('列数和表头不一致。');
      const get = col => (row[names.indexOf(col)] ?? '').trim();
      const type = byName[get('类型')];
      const date = get('日期').replaceAll('/','-').replace(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/, (_,y,m,d) => [y,m.padStart(2,'0'),d.padStart(2,'0')].join('-'));
      const accountName = get('账户');
      const toName = get('转入账户');
      const groupName = get('分类组');
      const categoryName = get('分类');
      const note = row[names.indexOf('备注')] ?? '';
      const providedId = get('记录编号');
      const time = get('时间');
      if (!Object.hasOwn(types,type) || !validDate(date) || !accountName || note.length > 160 ||
        [accountName,toName,groupName,categoryName].some(name => name.length > 28) ||
        (providedId && !/^[a-zA-Z0-9_-]{1,100}$/.test(providedId))) throw new Error('日期、类型、账户、备注或编号无效。');
      if (!validTime(time)) throw new Error('时间请填 24 小时制的 HH:mm，或留空。');
      if (type === 'transfer' ? !toName || toName === accountName || groupName || categoryName : toName || !groupName || !categoryName) {
        throw new Error('请检查分类和转入账户。');
      }
      const amount = parseMoney(get('金额'));
      if (providedId && ids.has(providedId)) { skipped++; return; }
      const resolveAccount = name => findOrAdd(book.accounts, acc => acc.name === name, {name, type:'other', opening:0, archived:false});
      const account = resolveAccount(accountName);
      let to='', category='';
      if (type === 'transfer') {
        to = resolveAccount(toName);
      } else {
        const kind = type === 'income' ? 'income' : 'expense';
        const group = findOrAdd(book.groups, g => g.type===kind && g.name===groupName, {name:groupName,type:kind,icon:'📁'});
        category = findOrAdd(book.categories, item => item.group===group && item.name===categoryName, {group,name:categoryName,archived:false});
      }
      const id = providedId || uid();
      book.entries.push({id,type,date,account,to,category,note,amount,...(time?{time}:{})});
      ids.add(id);
      added++;
    } catch (error) {
      throw new Error(`第 ${index+2} 行记录：${error.message}`);
    }
  });
  return {added,skipped};
}

export function download(name, content, type) {
  const file = content instanceof Blob ? content : new Blob([content], {type});
  const url = URL.createObjectURL(file);
  const link = Object.assign(document.createElement('a'), {href:url,download:name});
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
