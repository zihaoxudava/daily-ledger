export const android = globalThis.DailyLedgerAndroid;
const origin = 'https://appassets.androidplatform.net';

function result(reply) {
  const value=JSON.parse(reply);
  if (value.error) throw new Error(value.error);
  return value.data;
}

export const readNativeBook = () => result(android.readBook());

async function stageFile(token,id,file) {
  for (let start=0;start<file.size;start+=192*1024) {
    const bytes=new Uint8Array(await file.slice(start,start+192*1024).arrayBuffer());
    let text='';
    for (let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192));
    result(android.append(token,id,btoa(text)));
  }
}

export async function writeNativeBook(book,index,files) {
  const token=result(android.begin());
  try {
    for (const [id,blob] of files) {
      if (index.has(id)) await stageFile(token,id,new Blob([blob]));
    }
    const sizes=Object.fromEntries([...index].map(([id,item])=>[id,item.size]));
    result(android.commit(token,JSON.stringify(book),JSON.stringify(sizes)));
  } finally { android.discard(token); }
}

export async function readNativeAttachment(item) {
  const response=await fetch(`${origin}/ledger-files/${encodeURIComponent(item.id)}`,{cache:'no-store'});
  if (!response.ok) throw new Error(`找不到附件「${item.name}」。`);
  const file=await response.blob();
  if (file.size!==item.size) throw new Error(`附件「${item.name}」不完整。`);
  return file.slice(0,file.size,item.type);
}

export async function saveNativeDownload(name,file) {
  const token=result(android.begin());
  try {
    await stageFile(token,'download',file);
    result(android.exportFile(token,name,file.type));
  } catch (error) {
    android.discard(token);
    throw error;
  }
}
