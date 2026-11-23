export const maxAttachmentBytes = 10_000_000;
export const maxAttachments = 6;
export const maxAttachmentTotal = 60_000_000;
export const maxBackupBytes = 160_000_000;
export const previewableImage = type => /^(image\/(jpeg|png|gif|webp|avif|heic|heif|bmp))$/.test(type);
const validType = type => typeof type === 'string' && (type === '' || /^[\w.+-]{1,64}\/[\w.+-]{1,64}$/.test(type));
const validName = name => typeof name === 'string' && name.trim() && name.length <= 180 && !/[\/\\\x00-\x1f]/.test(name);

export function attachmentFromFile(file,id) {
  if (file.size < 1 || file.size > maxAttachmentBytes) throw new Error('每个附件须大于 0 且不超过 10 MB。');
  const name=file.name.replace(/[\/\\\x00-\x1f]/g,'_').slice(0,180).trim() || '附件';
  return {id,name,size:file.size,type:validType(file.type) ? file.type : ''};
}

export function attachmentIndex(book) {
  const index=new Map();
  let bytes=0;
  function collect({attachments}) {
    if (attachments===undefined) return;
    if (!Array.isArray(attachments) || attachments.length > maxAttachments) throw new Error('每笔最多保存 6 个附件。');
    for (const item of attachments) {
      if (!item || typeof item.id!=='string' || !/^[\w-]{1,100}$/.test(item.id) || index.has(item.id) ||
          !validName(item.name) || !validType(item.type) || !Number.isSafeInteger(item.size) ||
          item.size<1 || item.size>maxAttachmentBytes) throw new Error('附件信息无效。');
      index.set(item.id,item);
      bytes+=item.size;
    }
  }
  for (const entry of book.entries) collect(entry);
  for (const debt of book.debts) {
    collect(debt);
    for (const payment of debt.payments) collect(payment);
  }
  if (bytes>maxAttachmentTotal) throw new Error('附件总量已超过 60 MB。请移除部分附件后重试。');
  return index;
}

export function requireAttachment(bytes,item) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength!==item.size) {
    throw new Error(`找不到完整附件「${item.name}」，请重新添加或恢复备份。`);
  }
  return bytes;
}

function encode(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result.slice(reader.result.indexOf(',')+1));
    reader.onerror=()=>reject(new Error('无法读取附件，请重新添加后备份。'));
    reader.readAsDataURL(blob);
  });
}

export async function buildBackup(book,files) {
  const json=JSON.stringify(book,null,2);
  if (!files.size) return new Blob([json],{type:'application/json'});
  const parts=[json.slice(0,-2),',\n  "attachmentFiles": {\n'];
  let separator='';
  for (const [id,blob] of files) {
    parts.push(separator,JSON.stringify(id),':"',await encode(blob),'"');
    separator=',\n';
  }
  parts.push('\n  }\n}');
  return new Blob(parts,{type:'application/json'});
}

export function restoreAttachmentFiles(book,data) {
  const index=attachmentIndex(book);
  const files=new Map();
  if (!index.size && data===undefined) return files;
  if (!data || typeof data!=='object' || Array.isArray(data) || Object.keys(data).length!==index.size) {
    throw new Error('备份缺少附件，请选择完整的 JSON 备份。');
  }
  for (const [id,item] of index) {
    const base64=Object.hasOwn(data,id) ? data[id] : undefined;
    if (typeof base64!=='string' || base64.length!==4*Math.ceil(item.size/3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new Error(`备份中的附件「${item.name}」不完整。`);
    }
    const binary=atob(base64);
    const bytes=new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    files.set(id,requireAttachment(bytes.buffer,item));
  }
  return files;
}
