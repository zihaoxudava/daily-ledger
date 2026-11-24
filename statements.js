import { zipTools } from './archive.js';
import { parseCSV } from './files.js';
import { groupOf, parseMoney, uid, validDate, validTime } from './store.js';

const clean=value=>String(value ?? '').normalize('NFKC').trim();
const title={wechat:'微信支付',alipay:'支付宝'};
const limit=25_000_000;
const aliases={
  date:['交易时间','交易创建时间','付款时间'],
  direction:['收/支','收支','收支类型'],
  amount:['金额','金额(元)','交易金额','交易金额(元)'],
  category:['交易类型','交易分类'],
  party:['交易对方','对方名称'],
  product:['商品','商品说明','商品名称'],
  status:['当前状态','交易状态'],
  reference:['交易单号','交易订单号','交易号'],
};
const col=(names,key)=>aliases[key].map(name=>names.indexOf(name)).find(i=>i>=0) ?? -1;

function decodeText(raw) {
  const bytes=new Uint8Array(raw);
  if (bytes[0]===255 && bytes[1]===254) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0]===254 && bytes[1]===255) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

function findHeader(rows) {
  return rows.findIndex(row=>{
    const names=row.map(clean);
    return ['date','direction','amount'].every(key=>col(names,key)>=0);
  });
}

function readCSV(raw) {
  const lines=raw.split(/\r\n|\r|\n/);
  const start=lines.findIndex(line=>/收\s*[\/／]?\s*支/.test(line) && /金额/.test(line) && /交易时间|交易创建时间|付款时间/.test(line));
  if (start<0) return {rows:[],hint:''};
  const body=lines.slice(start).join('\n');
  return {rows:parseCSV(body,true),hint:lines.slice(0,start).join(' ')};
}

function xml(text) {
  if (/<!DOCTYPE/i.test(text)) throw new Error('账单不支持该 XML 格式。');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Excel 账单损坏。');
  return doc;
}

function sheetIndex(reference) {
  const letters=/^[A-Z]{1,3}/.exec(reference)?.[0];
  if (!letters) return -1;
  return Array.from(letters).reduce((value,char)=>value*26+char.charCodeAt(0)-64,0)-1;
}

async function readExcel(file) {
  const zip=await zipTools();
  const reader=new zip.ZipReader(new zip.BlobReader(file));
  try {
    const entries=await reader.getEntries();
    const docs=new Map(entries.map(entry=>[entry.filename,entry]));
    if (!docs.has('xl/workbook.xml')) throw new Error('请选择解压后的微信或支付宝 CSV 或 XLSX 文件。');
    const read=async entry=>{
      if (entry.encrypted || entry.uncompressedSize>48_000_000) throw new Error('Excel 工作表不能读取，请拆分文件或导出 CSV。');
      return xml(await entry.getData(new zip.TextWriter(),{checkSignature:true}));
    };
    const text=element=>[...element.getElementsByTagName('t')].map(node=>node.textContent).join('');
    const shared=docs.get('xl/sharedStrings.xml');
    const strings=shared?[...(await read(shared)).getElementsByTagName('si')].map(text):[];
    const workbook=await read(docs.get('xl/workbook.xml'));
    const date1904=/^(1|true)$/.test(workbook.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904') ?? '');
    for (const entry of entries.filter(item=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(item.filename)).slice(0,50)) {
      const rows=[...(await read(entry)).getElementsByTagName('row')].map(row=>{
        const values=[];
        for (const cell of row.getElementsByTagName('c')) {
          const offset=sheetIndex(cell.getAttribute('r') ?? '');
          const kind=cell.getAttribute('t');
          const raw=cell.getElementsByTagName('v')[0]?.textContent ?? '';
          if (offset>=0 && offset<200) values[offset]=kind==='s'?strings[Number(raw)] ?? '':kind==='inlineStr'?text(cell):raw;
        }
        return Array.from(values,value=>value ?? '');
      });
      const start=findHeader(rows);
      if (start>=0) return {rows:rows.slice(start),hint:rows.slice(0,start).flat().join(' '),date1904};
    }
    return {rows:[],hint:''};
  } finally { await reader.close(); }
}

function timestamp(value,date1904) {
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const epoch=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);
    value=new Date(epoch+Math.round(Number(value)*86_400_000)).toISOString();
  }
  const part=/^(20\d\d)[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T](\d{1,2}):(\d{2}))?/.exec(value);
  if (!part) return {};
  const [,y,m,d,h,min]=part;
  return {date:`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`,time:h?`${h.padStart(2,'0')}:${min}`:''};
}

export async function readStatement(file) {
  if (file.size>limit) throw new Error('账单超过 25 MB，请缩短导出日期范围后分批导入。');
  const {rows,hint,date1904}=/\.xlsx$/i.test(file.name)?await readExcel(file):readCSV(decodeText(await file.arrayBuffer()));
  const names=(rows[0] ?? []).map(clean);
  const provider=/支付宝/.test(hint) || names.includes('交易订单号') || names.includes('商家订单号')?'alipay':
    /微信/.test(hint) || names.includes('交易单号') && names.includes('交易对方')?'wechat':null;
  if (!provider || findHeader(rows)!==0) throw new Error('没有识别到微信或支付宝的账单表头。');
  const positions=Object.fromEntries(Object.keys(aliases).map(key=>[key,col(names,key)]));
  const entries=[],skipped=[];
  rows.slice(1).forEach((row,index)=>{
    const get=key=>clean(row[positions[key]]);
    const rawDate=get('date');
    if (!rawDate || !/^(20\d{2}[-/.年]|\d{5}(?:\.\d+)?$)/.test(rawDate)) return;
    const {date,time}=timestamp(rawDate,date1904);
    const direction=get('direction');
    const category=get('category');
    const status=get('status');
    const reference=get('reference').replace(/^'+/,'').slice(0,160);
    const description=[get('party'),get('product')].filter(value=>value && value!=='/').join(' · ');
    const skip=reason=>skipped.push({date:date ?? rawDate,description,reason});
    if (!validDate(date) || !validTime(time)) { skip('日期或时间无效'); return; }
    if (/失败|关闭|取消|处理中|待支付|待付款|待收款|未完成|全额退款|部分退款|交易退款/.test(status)) {
      skip(status || '状态待确认'); return;
    }
    if (/充值|提现|信用卡还款|花呗还款|余额宝转[入出]|零钱通转[入出]/.test(category || get('product'))) {
      skip('资金划转，请核对是否为账户间转账'); return;
    }
    let type=direction==='支出'?'expense':direction==='收入'||direction==='收款'?'income':null;
    if (type==='income' && /退款|退回/.test(category || get('product'))) type='refund';
    if (!type) { skip('平台标为不计收支或方向待确认'); return; }
    try {
      const amount=parseMoney(get('amount').replace(/元$/,'').trim());
      entries.push({index,date,time,type,amount,note:description.slice(0,160),provider,reference});
    } catch { skip('金额无法识别'); }
  });
  if (!entries.length && !skipped.length) throw new Error('账单中没有找到流水。');
  return {provider,label:title[provider],entries,skipped};
}

const referenceOf=row=>row.reference?`${row.provider}/${row.type}/${row.reference}`:'';
const matchOf=row=>`${row.date}/${row.type}/${row.amount}`;

export function reviewStatement(book,statement) {
  const references=new Set(book.entries.map(entry=>entry.statement &&
    referenceOf({...entry.statement,type:entry.statement.flow})).filter(Boolean));
  const matches=new Set(book.entries.map(matchOf));
  const fresh=[],possible=[];
  let duplicates=0;
  for (const row of statement.entries) {
    const ref=referenceOf(row);
    if (ref && references.has(ref)) { duplicates++; continue; }
    if (ref) references.add(ref);
    (matches.has(matchOf(row)) ? possible : fresh).push(row);
  }
  return {fresh,possible,duplicates};
}

export function applyStatement(book,statement,selected,account) {
  if (!book.accounts.some(item=>item.id===account && !item.archived)) throw new Error('请选择一个可用的账户。');
  const {fresh,possible,duplicates}=reviewStatement(book,statement);
  const confirmed=possible.filter(row=>selected.has(String(row.index)));
  const categories=new Map();
  for (const row of [...fresh,...confirmed]) {
    const kind=row.type==='income'?'income':'expense';
    if (!categories.has(kind)) {
      let group=book.groups.find(item=>item.type===kind && item.name==='账单导入');
      if (!group) { group={id:uid(),type:kind,name:'账单导入',icon:'🧾'}; book.groups.push(group); }
      let category=book.categories.find(item=>item.group===group.id && item.name===statement.label && !item.archived);
      if (!category) { category={id:uid(),group:group.id,name:statement.label,archived:false}; book.categories.push(category); }
      categories.set(kind,category.id);
    }
    book.entries.push({id:uid(),date:row.date,...(row.time?{time:row.time}:{}),
      type:row.type,amount:row.amount,account,to:'',category:categories.get(kind),note:row.note,
      statement:{provider:row.provider,reference:row.reference,flow:row.type}});
  }
  return {added:fresh.length+confirmed.length,skipped:duplicates+possible.length-confirmed.length+statement.skipped.length};
}
