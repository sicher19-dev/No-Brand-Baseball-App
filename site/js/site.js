/* Inner pages: top bar menus, scroll reveals and the shuffled pen card. The home page carries its own copy of the menus inside home.js. */
(function(){
'use strict';
var D=document, W=window, root=D.documentElement;
root.classList.add('js');
function $(s,c){return (c||D).querySelector(s);}
function $$(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s));}
var mq=W.matchMedia?W.matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
if(!mq.matches) root.classList.add('motion');

var lb=$('#loginBtn'), lm=$('#loginMenu'), lw=$('.nav__login');
function setLogin(open){lb.setAttribute('aria-expanded',open?'true':'false');lm.hidden=!open;}
lb.addEventListener('click',function(){setLogin(lm.hidden);});
D.addEventListener('click',function(e){if(!lm.hidden&&!lw.contains(e.target))setLogin(false);});
lw.addEventListener('focusout',function(e){if(e.relatedTarget&&!lw.contains(e.relatedTarget))setLogin(false);});

var mb=$('#menuBtn'), sheet=$('#sheet'), sc=$('#sheetClose');
function openSheet(){sheet.hidden=false;mb.setAttribute('aria-expanded','true');root.classList.add('lock');W.requestAnimationFrame(function(){sheet.classList.add('open');});sc.focus();}
function closeSheet(){sheet.classList.remove('open');sheet.hidden=true;mb.setAttribute('aria-expanded','false');root.classList.remove('lock');mb.focus();}
mb.addEventListener('click',openSheet);
sc.addEventListener('click',closeSheet);
sheet.addEventListener('keydown',function(e){
  if(e.key!=='Tab')return;
  var f=$$('a[href],button',sheet), a=f[0], z=f[f.length-1];
  if(e.shiftKey&&D.activeElement===a){e.preventDefault();z.focus();}
  else if(!e.shiftKey&&D.activeElement===z){e.preventDefault();a.focus();}
});
D.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  if(!sheet.hidden)closeSheet();
  else if(!lm.hidden){setLogin(false);lb.focus();}
});
if(W.matchMedia){var wide=W.matchMedia('(min-width:981px)');var onWide=function(e){if(e.matches&&!sheet.hidden)closeSheet();};if(wide.addEventListener)wide.addEventListener('change',onWide);}

var rv=$$('[data-rv]');
function showAll(){rv.forEach(function(el){el.classList.add('in');});}
if('IntersectionObserver' in W){
  var rio=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');rio.unobserve(e.target);}});},{threshold:.08});
  rv.forEach(function(el){rio.observe(el);});
}else{showAll();}
W.addEventListener('beforeprint',showAll);

/* shuffled pen card */
var pen=$('#pen');
if(pen){
  var out=$('#penList'), meta=$('#penMeta');
  var deal=function(){
    var types=$$('input[type=checkbox]:checked',pen).map(function(i){return i.value;});
    var n=parseInt($('#penN').value,10)||30, list=[], i, j, t;
    if(types.length<2){out.innerHTML='';meta.textContent='Pick at least two pitch types';return;}
    for(i=0;i<n;i++)list.push(types[i%types.length]);
    for(i=list.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=list[i];list[i]=list[j];list[j]=t;}
    out.innerHTML=list.map(function(x){return '<li>'+x+'</li>';}).join('');
    meta.textContent=n+' pitches, '+types.length+' pitch types, even split';
  };
  pen.addEventListener('change',deal);
  $('#penDeal').addEventListener('click',deal);
  $('#penPrint').addEventListener('click',function(){W.print();});
  deal();
}
})();
