export function setupWorkspace(){
 const $=id=>document.getElementById(id);
 const nav=document.querySelector('.topbar nav');
 nav.innerHTML='<a href="#conditions">Inputs</a><a href="#projection">Range outlook</a><a href="#comparison">Compare</a><a href="#sessions-section">Session paths</a><a href="#ny-reference">New York</a><a href="#tags-section">Tags</a><a href="#evidence">Evidence</a><button id="dictionary-btn" class="quiet">Dictionary</button>';
 $('projection').classList.add('workspace-column');$('projection').append($('indicator-section'));
 const rail=document.querySelector('main');rail.id='workspace';
 const move=direction=>rail.scrollBy({left:direction*Math.max(400,rail.clientWidth*.75),behavior:'smooth'});
 $('edge-left').onclick=()=>move(-1);$('edge-right').onclick=()=>move(1);
 const arrows=()=>{$('edge-left').disabled=rail.scrollLeft<4;$('edge-right').disabled=rail.scrollLeft>=rail.scrollWidth-rail.clientWidth-4;};
 rail.addEventListener('scroll',arrows,{passive:true});window.addEventListener('resize',arrows);setTimeout(arrows,300);
 for(const link of document.querySelectorAll('a[href^="#"]'))link.addEventListener('click',e=>{const target=document.querySelector(link.getAttribute('href'));if(target){e.preventDefault();target.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});}});
}
