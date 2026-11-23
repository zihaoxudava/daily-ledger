import { attachmentFromFile, maxAttachments, previewableImage } from './attachments.js';
import { readAttachment, uid } from './store.js';
import { download } from './files.js';
import { esc, icon } from './views.js';

const drafts=new WeakMap();
const preview=document.querySelector('#attachment-preview');
const previewImage=preview.querySelector('img');
let previewUrl, previewFile;

export function noteFields(name,note='') {
  return `<div class="note-field">
    <div class="note-caption">
      <label for="${name}-input">备注（选填）</label>
      <div class="note-actions">
        <button type="button" class="button secondary" data-note="photos">${icon('photo')}照片</button>
        <button type="button" class="button secondary" data-note="files">${icon('file')}文件</button>
      </div>
    </div>
    <textarea id="${name}-input" name="${name}" rows="2" maxlength="160" placeholder="用途、商家或其他说明">${esc(note)}</textarea>
    <input type="file" data-picker="photos" aria-label="选择照片" accept="image/*" multiple hidden>
    <input type="file" data-picker="files" aria-label="选择文件" multiple hidden>
    <ul class="attachment-list" hidden></ul><p class="error" role="alert" hidden></p>
  </div>`;
}

export const noteDraft = scope => drafts.get(scope.querySelector('.note-field'));

export function readNote(scope,text,files) {
  const draft=noteDraft(scope);
  if (!draft.items.length) return {note:text};
  for (const [id,file] of draft.files) files.set(id,file);
  return {note:text,attachments:[...draft.items]};
}

export function mountNote(scope,attachments=[],draft) {
  const root=scope.querySelector('.note-field');
  const editable=!!root.querySelector('.note-actions');
  const list=root.querySelector('.attachment-list');
  const error=root.querySelector('.error');
  const state=draft ?? {items:[...attachments],files:new Map()};
  drafts.set(root,state);

  function render() {
    list.hidden=!state.items.length;
    list.innerHTML=state.items.map(item=>`<li>
      <button type="button" class="attachment-open" data-note="open" data-id="${esc(item.id)}">
        ${icon(previewableImage(item.type)?'photo':'file')}<span>${esc(item.name)}<small>${formatSize(item.size)}</small></span>
      </button>
      ${editable?`<button type="button" class="icon-button" data-note="remove" data-id="${esc(item.id)}" aria-label="移除 ${esc(item.name)}">${icon('close')}</button>`:''}
    </li>`).join('');
  }
  function fail(message) {
    error.textContent=message;
    error.hidden=false;
  }
  root.addEventListener('change',event=>{
    const picker=event.target;
    if (!picker.dataset.picker) return;
    error.hidden=true;
    try {
      const files=[...picker.files];
      if (state.items.length+files.length>maxAttachments) throw new Error('每笔最多添加 6 个附件。');
      const added=files.map(file=>[attachmentFromFile(file,uid()),file]);
      for (const [item,file] of added) {
        state.items.push(item);
        state.files.set(item.id,file);
      }
      render();
    } catch (cause) { fail(cause.message); }
    picker.value='';
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-note]');
    if (!button || root.closest('form').querySelector('button[type=submit]')?.disabled) return;
    error.hidden=true;
    const {note,id}=button.dataset;
    if (note==='photos' || note==='files') {
      root.querySelector(`[data-picker="${note}"]`).click();
      return;
    }
    const item=state.items.find(attachment=>attachment.id===id);
    if (note==='remove') {
      state.items=state.items.filter(attachment=>attachment.id!==id);
      state.files.delete(id);
      render();
    } else if (item) {
      try {
        const blob=state.files.get(id) ?? await readAttachment(item);
        if (!root.isConnected || !root.closest('dialog').open) return;
        if (previewableImage(item.type)) openPhoto(item,blob);
        else await saveFile(item,blob);
      } catch (cause) { fail(cause.message); }
    }
  });
  render();
}

function formatSize(bytes) {
  return bytes<1_000_000 ? `${Math.max(1,Math.ceil(bytes/1000))} KB` : `${(bytes/1_000_000).toFixed(1)} MB`;
}

function saveFile(item,blob) {
  return download(item.name,blob.slice(0,blob.size,'application/octet-stream'));
}

function openPhoto(item,blob) {
  if (preview.open) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewFile={item,blob};
  previewUrl=URL.createObjectURL(blob.slice(0,blob.size,item.type));
  preview.querySelector('h2').textContent=item.name;
  preview.querySelector('.error').hidden=true;
  previewImage.hidden=false;
  previewImage.src=previewUrl;
  preview.showModal();
}

previewImage.addEventListener('error',()=>{
  if (!preview.open) return;
  previewImage.hidden=true;
  preview.querySelector('.error').hidden=false;
});
preview.querySelector('[data-download]').addEventListener('click',async()=>{
  try { await saveFile(previewFile.item,previewFile.blob); }
  catch (error) {
    const label=preview.querySelector('.error');
    label.textContent=error.message;
    label.hidden=false;
  }
});
preview.addEventListener('close',()=>{
  if (preview.open) return;
  previewImage.removeAttribute('src');
  URL.revokeObjectURL(previewUrl);
  previewUrl=previewFile=undefined;
});
