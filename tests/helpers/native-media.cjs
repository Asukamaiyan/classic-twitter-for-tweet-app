// DOM and minimal event behavior of the verified Tweet v2.2.3 GX/Fg widgets.
function galleryMarkup(count = 3, id = 'gallery') {
  return `<div class="mt-3"><div class="relative overflow-hidden rounded-2xl border border-tl-app-border bg-black">
    <div id="${id}" class="flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
      ${Array.from({length:count}, (_, i) => `<button type="button" class="relative w-full min-w-full shrink-0 snap-start aspect-[4/3] bg-black" aria-label="Open image ${i+1} of ${count}"><img src="https://media.tweet.app/${id}-${i}.jpg" alt="Attached media ${i+1} of ${count}" class="h-full w-full object-cover" referrerpolicy="no-referrer"></button>`).join('')}
    </div>
    <button type="button" data-inline-prev aria-label="Previous image">Previous</button>
    <button type="button" data-inline-next aria-label="Next image">Next</button>
    <div aria-live="polite" data-inline-count>1/${count}</div>
    <div class="absolute bottom-3 left-1/2 flex" aria-label="Choose image" data-inline-dots>${Array.from({length:count},(_,i)=>`<button type="button" aria-label="Show image ${i+1} of ${count}" aria-current="${i===0}">${i+1}</button>`).join('')}</div>
  </div></div>`;
}
function viewerMarkup({id='', source='https://media.tweet.app/photo.jpg', count=3, contained=false}={}) {
  return `<div ${id?`id="${id}"`:''} class="${contained?'absolute':'fixed'} inset-0 z-100 flex flex-col bg-black/90 animate-fadeIn" role="dialog" aria-modal="true" aria-label="Media viewer">
    <div class="flex items-center justify-between px-3 py-3 shrink-0"><button type="button" aria-label="Close media viewer"><svg class="lucide lucide-x"></svg></button><span class="text-sm text-white" aria-live="polite" data-native-count>1/${count}</span></div>
    <div class="relative flex flex-1 min-h-0 items-center justify-center px-3 pb-6"><button type="button" aria-label="Previous image" class="absolute left-3 top-1/2 z-10" data-native-prev disabled><svg class="lucide lucide-chevron-left"></svg></button><img src="${source}" alt="Attached media" class="max-h-full max-w-full select-none object-contain" referrerpolicy="no-referrer" draggable="false"><button type="button" aria-label="Next image" class="absolute right-3 top-1/2 z-10" data-native-next><svg class="lucide lucide-chevron-right"></svg></button></div>
  </div>`;
}
function installNativeViewer(window, images, {asyncCommit=false}={}) {
  const {document}=window;
  let dialog, index=0, startX=null;
  const clicked=[];
  const calls={next:0,prev:0,key:0,touch:0};
  const commit = next => {
    index=Math.max(0,Math.min(images.length-1,next));
    if (!dialog?.isConnected) {
      const shell=document.createElement('div'); shell.innerHTML=viewerMarkup({source:images[index].src,count:images.length});
      dialog=shell.firstElementChild; document.body.append(dialog);
      dialog.querySelector('[aria-label="Close media viewer"]').addEventListener('click',event=>{event.stopPropagation();dialog.remove();});
      dialog.querySelector('[data-native-prev]').addEventListener('click',event=>{event.stopPropagation();calls.prev++;choose(index-1);});
      dialog.querySelector('[data-native-next]').addEventListener('click',event=>{event.stopPropagation();calls.next++;choose(index+1);});
      dialog.querySelector('img').addEventListener('click',event=>event.stopPropagation());
      dialog.addEventListener('click',()=>dialog.remove());
    }
    dialog.querySelector('img').src=images[index].src;
    dialog.querySelector('[data-native-count]').textContent=`${index+1}/${images.length}`;
    dialog.querySelector('[data-native-prev]').disabled=index===0;
    dialog.querySelector('[data-native-next]').disabled=index===images.length-1;
    clicked.push(index);
  };
  const choose=next=>asyncCommit?window.queueMicrotask(()=>commit(next)):commit(next);
  images.forEach((image,i)=>image.parentElement.addEventListener('click',event=>{event.stopPropagation();choose(i);}));
  // React delegates touch handlers above the dialog: its native handler must
  // not run again after an extension-owned commit or during browser pinch zoom.
  document.body.addEventListener('touchstart',event=>{
    if(dialog?.isConnected&&dialog.contains(event.target))startX=event.touches?.[0]?.clientX??null;
  });
  document.body.addEventListener('touchend',event=>{
    if(!dialog?.isConnected||!dialog.contains(event.target))return;
    const end=event.changedTouches?.[0]?.clientX;calls.touch++;
    if(startX!==null&&end!==undefined&&Math.abs(end-startX)>=40)choose(index+(end<startX?1:-1));
    startX=null;
  });
  document.addEventListener('keydown',event=>{
    if(!dialog?.isConnected)return;
    if(event.key==='Escape'){dialog.remove();return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    calls.key++;
    choose(event.key==='Home'?0:event.key==='End'?images.length-1:index+(event.key==='ArrowRight'?1:-1));
  });
  return {clicked,calls,commit, get dialog(){return dialog;}, get index(){return index;}};
}
module.exports={galleryMarkup,viewerMarkup,installNativeViewer};
