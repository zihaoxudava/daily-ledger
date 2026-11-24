import { attachmentIndex, restoreAttachmentFiles } from './attachments.js';
import { validate } from './store.js';

const archiveName='ledger.json';
const backupFormat='daily-ledger-archive';
let loading;

export function zipTools() {
  if (!loading) loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('./vendor/zip.min.js',import.meta.url);
    script.onload=()=>{
      globalThis.zip.configure({useWebWorkers:false});
      resolve(globalThis.zip);
    };
    script.onerror=()=>{ script.remove(); reject(new Error('无法加载压缩文件工具，请重新打开账本。')); };
    document.head.append(script);
  }).catch(error=>{ loading=undefined; throw error; });
  return loading;
}

const path=id=>`attachments/${id}`;
const ledgerScopes=book=>[['main',book],...(book.ledgers ?? []).map(item=>[item.id,item.data])];

export function ledgerOnly(book) {
  const rows=structuredClone(book);
  delete rows.wallpapers;
  for (const [,ledger] of ledgerScopes(rows)) {
    for (const entry of ledger.entries) delete entry.attachments;
    for (const debt of ledger.debts) {
      delete debt.attachments;
      for (const payment of debt.payments) delete payment.attachments;
    }
  }
  return new Blob([JSON.stringify(rows)],{type:'application/json'});
}

export function compareRestore(before,after) {
  const entries=book=>new Map(ledgerScopes(book).flatMap(([id,ledger])=>ledger.entries.map(row=>[`${id}/${row.id}`,row])));
  const current=entries(before),incoming=entries(after);
  let added=0,overwritten=0,removed=0;
  for (const id of incoming.keys()) {
    if (current.has(id)) overwritten++;
    else added++;
  }
  for (const id of current.keys()) if (!incoming.has(id)) removed++;
  return {added,overwritten,removed,ledgers:ledgerScopes(after).length,attachments:attachmentIndex(after).size};
}

export async function writeBackupZip(book,read,progress,output) {
  const zip=await zipTools();
  const blob=output ? null : new zip.BlobWriter('application/zip');
  const writer=new zip.ZipWriter(output ?? blob,{level:0,keepOrder:true});
  const files=attachmentIndex(book);
  const metadata=JSON.stringify({format:backupFormat,version:1,book});
  let completed=0;
  const total=files.size+1;
  await writer.add(archiveName,new zip.TextReader(metadata));
  progress(++completed,total);
  for (const [id,item] of files) {
    const file=await read(item);
    await writer.add(path(id),new zip.BlobReader(file),{onprogress:(done,bytes)=>progress(completed+(bytes?done/bytes:0),total)});
    progress(++completed,total);
  }
  await writer.close();
  return blob?.getData();
}

export async function readBackupFile(file) {
  const head=new Uint8Array(await file.slice(0,2).arrayBuffer());
  if (head[0]!==0x50 || head[1]!==0x4b) {
    let parsed;
    try { parsed=JSON.parse(await file.text()); }
    catch { throw new Error('请选择日常账本导出的 ZIP 或 JSON 备份。'); }
    const {attachmentFiles,...data}=parsed ?? {};
    const book=validate(data);
    return {book,files:restoreAttachmentFiles(book,attachmentFiles)};
  }
  const zip=await zipTools();
  const reader=new zip.ZipReader(new zip.BlobReader(file));
  try {
    const entries=await reader.getEntries();
    const byName=new Map(entries.map(entry=>[entry.filename,entry]));
    const details=byName.get(archiveName);
    if (!details || details.directory || details.encrypted || byName.size!==entries.length ||
        details.compressionMethod!==0 || details.compressedSize!==details.uncompressedSize || details.uncompressedSize>128_000_000) {
      throw new Error('备份目录不完整或账目文件超过可读取容量。');
    }
    const metadata=JSON.parse(await details.getData(new zip.TextWriter(),{checkSignature:true}));
    if (metadata?.format!==backupFormat || metadata.version!==1) throw new Error('请选择日常账本的备份压缩包。');
    const book=validate(metadata.book);
    const assets=attachmentIndex(book);
    if (assets.size+1!==entries.length) throw new Error('备份中的附件数量不匹配。');
    for (const [id,item] of assets) {
      const entry=byName.get(path(id));
      if (!entry || entry.directory || entry.encrypted || entry.uncompressedSize!==item.size ||
          entry.compressedSize!==item.size || entry.compressionMethod!==0) {
        throw new Error(`备份附件「${item.name}」不完整。`);
      }
    }
    const files={
      async *[Symbol.asyncIterator]() {
        for (const [id,item] of assets) {
          yield [id,await byName.get(path(id)).getData(new zip.BlobWriter(item.type),{checkSignature:true})];
        }
      },
    };
    return {book,files,close:()=>reader.close()};
  } catch (error) {
    await reader.close();
    throw error;
  }
}
