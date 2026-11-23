(function(){
'use strict';
var D=document, W=window, root=D.documentElement;
root.classList.add('js');
function $(s,c){return (c||D).querySelector(s);}
function $$(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s));}
function clamp(v,a,b){return v<a?a:(v>b?b:v);}
function median(a){var s=a.slice().sort(function(x,y){return x-y;});return s[s.length>>1];}

var mq=W.matchMedia?W.matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
var reduced=!!mq.matches;
if(!reduced) root.classList.add('motion');

var hero=$('#hero');
W.requestAnimationFrame(function(){hero.classList.add('is-on');});
W.setTimeout(function(){hero.classList.add('is-on');},400); /* the headline must never wait on a paint */

/* ---------- preview bar ---------- */
var needMeasure=true;

/* ---------- nav: log in menu ---------- */
var lb=$('#loginBtn'), lm=$('#loginMenu'), lw=$('.nav__login');
function setLogin(open){lb.setAttribute('aria-expanded',open?'true':'false');lm.hidden=!open;}
lb.addEventListener('click',function(){setLogin(lm.hidden);});
D.addEventListener('click',function(e){if(!lm.hidden&&!lw.contains(e.target))setLogin(false);});
lw.addEventListener('focusout',function(e){if(e.relatedTarget&&!lw.contains(e.relatedTarget))setLogin(false);});

/* ---------- nav: full-screen menu ---------- */
var mb=$('#menuBtn'), sheet=$('#sheet'), sc=$('#sheetClose');
$$('a.brand').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();if(!sheet.hidden)closeSheet();W.scrollTo({top:0,behavior:'instant'});});});
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

/* ---------- pitch grades: the sample numbers run up the 20 to 80 scale ---------- */
var gradeEls=$$('.fr b'), gradeTo=gradeEls.map(function(b){return parseInt(b.textContent,10)||0;}), gradeT0=-1;
function gradesTick(now){
  if(gradeT0<0)return;
  if(reduced){gradeT0=-1;return;}
  var done=true, i, u, val;
  for(i=0;i<gradeEls.length;i++){
    u=clamp((now-gradeT0-250-i*150)/1100,0,1);
    if(u<1)done=false;
    val=String(Math.round(20+(gradeTo[i]-20)*(1-Math.pow(1-u,3))));
    if(gradeEls[i].textContent!==val)gradeEls[i].textContent=val;
  }
  if(done)gradeT0=-1;
}

/* ---------- reveal on scroll ---------- */
var rv=$$('[data-rv]'), rvis=$$('.vis');
if('IntersectionObserver' in W){
  var rio=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');rio.unobserve(e.target);}});},{threshold:.18});
  rv.forEach(function(el){rio.observe(el);});
  /* the chapter graphics draw themselves once they are properly on screen, not while they are still sliding in */
  var gio=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');gio.unobserve(e.target);if(e.target.classList.contains('grades'))gradeT0=performance.now();}});},{threshold:.45});
  if(!reduced)gradeEls.forEach(function(b){b.textContent='20';});
  rvis.forEach(function(el){gio.observe(el);});
}else{rv.concat(rvis).forEach(function(el){el.classList.add('in');});}

/* ---------- shared figure drawing ---------- */
var GOLD='245,183,0', INK='239,236,228', TAU=6.2832;
var BONES_B=[[5,7],[7,9],[5,6],[11,12],[5,11],[6,12],[11,13],[13,15],[12,14],[14,16],[15,19],[19,17],[15,17],[16,22],[22,20],[16,20]];
var BONES_T=[[6,8],[8,10]];   /* the throwing arm, drawn on its own so it can fade where the tracker loses it */
var DOTS_B=[5,6,7,9,11,12,13,14,15,16], DOTS_T=[8,10];
var tx=0, ty=0;

/* one joint at a fractional pose frame, mapped to canvas pixels (result in tx, ty) */
function at(kp,f,j,m){
  var n=kp.length-1; f=clamp(f,0,n);
  var i=Math.floor(f), t=f-i, a=kp[i], b=kp[i<n?i+1:n], k=2*j;
  tx=m.x+(a[k]+(b[k]-a[k])*t)*m.kx;
  ty=m.y+(a[k+1]+(b[k+1]-a[k+1])*t)*m.ky;
}
/* the whole pose at a fractional frame, linearly interpolated, into P */
function pose(kp,f,m,P){
  var n=kp.length-1; f=clamp(f,0,n);
  var i=Math.floor(f), t=f-i, a=kp[i], b=kp[i<n?i+1:n];
  for(var k=0;k<46;k+=2){
    P[k]=m.x+(a[k]+(b[k]-a[k])*t)*m.kx;
    P[k+1]=m.y+(a[k+1]+(b[k+1]-a[k+1])*t)*m.ky;
  }
}
function bonePath(c,P,bones){
  c.beginPath();
  for(var i=0;i<bones.length;i++){var a=bones[i][0]*2,b=bones[i][1]*2;c.moveTo(P[a],P[a+1]);c.lineTo(P[b],P[b+1]);}
}
function drawBody(c,P,o){
  c.lineCap='round';c.lineJoin='round';
  var hx=(P[6]+P[8])/2, hy=(P[7]+P[9])/2, nx=(P[10]+P[12])/2, ny=(P[11]+P[13])/2;
  var dx=hx-nx, dy=hy-ny, d=Math.sqrt(dx*dx+dy*dy)||1, r=o.headR, al=+o.alpha, arm=o.arm==null?1:o.arm, i, k;
  bonePath(c,P,BONES_B);
  if(d>r){c.moveTo(nx,ny);c.lineTo(hx-dx/d*r,hy-dy/d*r);}
  c.moveTo(hx+r,hy);c.arc(hx,hy,r,0,TAU);
  if(o.under){c.strokeStyle='rgba(0,0,0,'+o.under+')';c.lineWidth=o.lw+2.6;c.stroke();}
  c.strokeStyle='rgba('+o.rgb+','+al+')';c.lineWidth=o.lw;c.stroke();
  if(o.dot){
    c.fillStyle='rgba('+o.rgb+','+al+')';c.beginPath();
    for(i=0;i<DOTS_B.length;i++){k=DOTS_B[i]*2;c.moveTo(P[k]+o.dot,P[k+1]);c.arc(P[k],P[k+1],o.dot,0,TAU);}
    c.fill();
  }
  if(arm>.02){
    var aa=(al*arm).toFixed(3);
    bonePath(c,P,BONES_T);
    if(o.under){c.strokeStyle='rgba(0,0,0,'+(o.under*arm).toFixed(3)+')';c.lineWidth=o.lw+2.6;c.stroke();}
    c.strokeStyle='rgba('+o.rgb+','+aa+')';c.lineWidth=o.lw;c.stroke();
    if(o.dot){
      c.fillStyle='rgba('+o.rgb+','+aa+')';c.beginPath();
      for(i=0;i<DOTS_T.length;i++){k=DOTS_T[i]*2;c.moveTo(P[k]+o.dot,P[k+1]);c.arc(P[k],P[k+1],o.dot,0,TAU);}
      c.fill();
    }
  }
}
/* How far to trust the tracked throwing arm, one value per pose frame (1 = draw it in full).
   In the few frames around release the hand is at top speed. If the tracked forearm shrinks to a fraction of its
   usual length there, the tracker has lost the hand, so the arm and its trail fade out instead of being drawn
   somewhere the arm is not. If the clip is tracked again and the arm holds its length, nothing fades. */
function armConf(kp,peak,ax,ay){
  var n=kp.length, len=[], c=new Float32Array(n), i, p, r;
  for(i=0;i<n;i++){p=kp[i];len.push(Math.sqrt(Math.pow((p[16]-p[20])*ax,2)+Math.pow((p[17]-p[21])*ay,2)));c[i]=1;}
  var m=median(len)||1;
  for(i=Math.max(0,peak-3);i<=Math.min(n-1,peak+1);i++){r=clamp((len[i]/m-.3)/.2,0,1);c[i]=r*r*(3-2*r);}
  return c;
}
function confAt(c,f){var n=c.length-1;f=clamp(f,0,n);var i=Math.floor(f);return c[i]+(c[i<n?i+1:n]-c[i])*(f-i);}
/* long-exposure trail: where one joint was over the last n half-frames, fading */
function trail(c,kp,f,j,m,n,rgb,a0,w0,glow,bb,cf){
  var px,py,i,u,fi,q,qp,qs;
  c.lineCap='butt';
  for(var pass=glow?0:1;pass<2;pass++){
    c.globalCompositeOperation=pass===0?'lighter':'source-over';
    at(kp,f,j,m);px=tx;py=ty;qp=cf?confAt(cf,f):1;
    for(i=1;i<=n;i++){
      fi=f-i*.5; if(fi<0)break;
      at(kp,fi,j,m);
      u=1-i/(n+1);
      /* a stretch the tracker was unsure of leaves a gap in the trail */
      q=cf?confAt(cf,fi):1;qs=q<qp?q:qp;qp=q;
      if(qs>.03){
        c.beginPath();c.moveTo(px,py);c.lineTo(tx,ty);
        if(pass===0){c.strokeStyle='rgba('+rgb+','+(a0*.2*u*u*qs).toFixed(3)+')';c.lineWidth=w0*u*5+2;}
        else{c.strokeStyle='rgba('+rgb+','+(a0*u*u*qs).toFixed(3)+')';c.lineWidth=w0*u+.5;}
        c.stroke();
        if(bb){if(tx<bb[0])bb[0]=tx;if(ty<bb[1])bb[1]=ty;if(tx>bb[2])bb[2]=tx;if(ty>bb[3])bb[3]=ty;}
      }
      px=tx;py=ty;
    }
  }
  c.globalCompositeOperation='source-over';
}
function pad3(n){var t=String(n);while(t.length<3)t='0'+t;return t;}
var MONO='"DM Mono",ui-monospace,Menlo,Consolas,monospace';
/* head ring radius in figure units, from ear spread and torso length */
function headUnits(kp,ax,ay){
  var e=[],t=[];
  for(var i=0;i<kp.length;i++){var p=kp[i];
    e.push(Math.sqrt(Math.pow((p[6]-p[8])*ax,2)+Math.pow((p[7]-p[9])*ay,2)));
    t.push(Math.sqrt(Math.pow(((p[10]+p[12])-(p[22]+p[24]))/2*ax,2)+Math.pow(((p[11]+p[13])-(p[23]+p[25]))/2*ay,2)));
  }
  return Math.max(median(e)*.6,median(t)*.18);
}
function sizeCanvas(cv,cw,ch,maxPx){
  var dpr=Math.min(W.devicePixelRatio||1,2);
  if(cw*ch*dpr*dpr>maxPx)dpr=Math.max(1,Math.sqrt(maxPx/(cw*ch)));
  var w=Math.max(1,Math.round(cw*dpr)), h=Math.max(1,Math.round(ch*dpr));
  if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
  return dpr;
}
/* fit a box-normalised figure (0..1000 on the long side) into a canvas, feet on the ground line */
function fitFigure(set,cw,ch,padX,padTop,padBot,left){
  var bw=set.w*1000, bh=set.h*1000;
  var s=Math.min((cw-2*padX)/bw,(ch-padTop-padBot)/bh);
  return {x:left?padX:(cw-bw*s)/2, y:ch-padBot-bh*s, kx:s, ky:s, s:s};
}

/* ---------- state ---------- */
var vw=0, vh=0, lastY=-1, force=true;
var io=('IntersectionObserver' in W);

/* ---------- hero: film + live tracking ---------- */
var VF=60;   /* video frames per second in the film. The tracking has one pose for every two of them. */
var v=$('#film'), hcv=$('#track'), hctx=hcv.getContext('2d'), navEl=$('.nav');
var meta=$('#meta'), rail=$('#rail'), seek=$('#seek'), fill=$('#fill'), tc=$('#tc'), ph=$('#ph'), pp=$('#pp'), ticksEl=$('#ticks');
var H=null, heroOK=false, heroVis=true, heroDirty=true, P=new Float32Array(46);
var foot=$('.hero__foot');
var stackMQ=W.matchMedia?W.matchMedia('(max-aspect-ratio:1/1)'):{matches:false};
var geo={cw:0,ch:0,dpr:1,s:1,floor:1e9,ceil:0,fade:0,mask:null,map:{x:0,y:0,kx:1,ky:1},headR:20};
var userPaused=reduced, ptrDown=false, kbFocus=false, lastKey=false, holdUntil=0, playPending=false;
var lastK=-1, vfT=-1, kMax=201, dirty=null, tcTxt='', phIdx=-1, phases=[], tickLis=[];

function heroPlain(){
  heroOK=false;hero.classList.add('hero--plain');meta.hidden=true;rail.hidden=true;
  try{v.pause();}catch(e){}
}
v.addEventListener('error',heroPlain);
v.addEventListener('loadedmetadata',function(){needMeasure=true;});
if('requestVideoFrameCallback' in v){
  var onVF=function(now,md){vfT=md.mediaTime;v.requestVideoFrameCallback(onVF);};
  v.requestVideoFrameCallback(onVF);
}
D.addEventListener('visibilitychange',function(){if(D.hidden){try{v.pause();}catch(e){}}});

function syncPP(){
  var paused=userPaused;
  pp.textContent=paused?'Play':'Pause';
  pp.setAttribute('aria-label',paused?'Play the film':'Pause the film');
}
pp.addEventListener('click',function(){userPaused=!userPaused;if(!userPaused){holdUntil=0;kbFocus=false;}syncPP();});

D.addEventListener('keydown',function(e){var k=e.key||'';if(k==='Tab'||k.indexOf('Arrow')===0)lastKey=true;},true);
D.addEventListener('pointerdown',function(){lastKey=false;},true);
seek.addEventListener('focus',function(){kbFocus=lastKey;if(H&&heroOK)seek.setAttribute('aria-valuetext',valueText(Math.max(lastK,0)));});
seek.addEventListener('blur',function(){kbFocus=false;});
seek.addEventListener('pointerdown',function(){ptrDown=true;});
function ptrUp(){if(ptrDown){ptrDown=false;holdUntil=performance.now()+700;}}
W.addEventListener('pointerup',ptrUp);
W.addEventListener('pointercancel',ptrUp);
seek.addEventListener('change',ptrUp);
/* k is a video frame. Seek to the middle of it, so the frame that lands on screen is never in doubt. */
function seekTo(k){k=clamp(Math.round(k),0,kMax);try{v.currentTime=(k+.5)/VF;}catch(e){}heroDirty=true;}
function valueText(k){
  var dt=k/VF-H.peak/H.fps, i=phaseAt(k/VF*H.fps);
  if(Math.abs(dt)<.004)return phases[i].n+'. The release frame.';
  return phases[i].n+'. '+Math.abs(dt).toFixed(2)+' seconds '+(dt<0?'before':'after')+' release.';
}
seek.addEventListener('input',function(){
  var k=+seek.value||0;
  if(!ptrDown)holdUntil=performance.now()+1400;
  seekTo(k);
  if(H)seek.setAttribute('aria-valuetext',valueText(k));
});
function phaseAt(f){var i=0;for(var k=0;k<phases.length;k++){if(f>=phases[k].f-.01)i=k;}return i;}

function findPhases(){
  var kp=H.kp, n=kp.length, ax=H.vw/1000, ay=H.vh/1000, i;
  /* leg lift: the frame where the lead (left) knee is highest */
  var lift=0, best=1e9;
  for(i=0;i<Math.min(H.peak,n);i++){if(kp[i][27]<best){best=kp[i][27];lift=i;}}
  /* hand break: the first frame the wrists come clearly apart and stay apart */
  var d=[];
  for(i=0;i<n;i++)d.push(Math.sqrt(Math.pow((kp[i][18]-kp[i][20])*ax,2)+Math.pow((kp[i][19]-kp[i][21])*ay,2)));
  var base=median(d.slice(0,Math.max(lift,10))), brk=Math.round((lift+H.peak)/2);
  for(i=10;i<H.peak-2;i++){if(d[i]>base*2&&d[i+1]>base*2&&d[i+2]>base*2){brk=i;break;}}
  phases=[{f:0,n:'Set'},{f:lift,n:'Leg lift'},{f:brk,n:'Hand break'},{f:H.peak,n:'Release'}];
  phases.sort(function(a,b){return a.f-b.f;});
}
function buildRail(){
  var dur=(isFinite(v.duration)&&v.duration>0)?v.duration:H.duration;
  kMax=Math.max(1,Math.round(dur*VF)-1);
  seek.max=String(kMax);
  ticksEl.textContent='';tickLis=[];
  phases.forEach(function(p,i){
    var li=D.createElement('li'), b=D.createElement('button'), k=p.f/H.fps*VF;
    li.style.setProperty('--f',clamp(k/kMax,0,1).toFixed(4));
    if(i>0&&i<phases.length-1&&(p.f-phases[i-1].f)/H.fps*VF/kMax<.12)li.className='t-min';
    b.type='button';b.textContent=p.n;b.setAttribute('aria-label','Go to '+p.n.toLowerCase());
    b.addEventListener('click',function(){holdUntil=performance.now()+1800;seekTo(k);});
    li.appendChild(b);ticksEl.appendChild(li);tickLis.push(li);
  });
  seek.setAttribute('aria-valuetext',valueText(0));
  meta.hidden=false;rail.hidden=false;syncPP();
}

function measureHero(){
  var cw=hero.clientWidth, ch=hero.clientHeight;
  var bx=v.offsetLeft, by=v.offsetTop, bw=v.offsetWidth, bh=v.offsetHeight;
  var op=(W.getComputedStyle(v).objectPosition||'50% 50%').split(' ');
  var px=parseFloat(op[0]), py=parseFloat(op[1]);
  px=(isFinite(px)&&op[0].indexOf('%')>0)?px/100:.5;
  py=(isFinite(py)&&op[1]&&op[1].indexOf('%')>0)?py/100:.5;
  /* the tracking stops at a floor: the top of the timeline. On tall screens the words sit under the film,
     so the floor is the end of the film and the figure fades into it. */
  var stacked=!!stackMQ.matches;
  var floor=rail.hidden?ch:(stacked?foot.offsetTop-6:foot.offsetTop+rail.offsetTop+12);
  /* and its label never slides under the nav */
  var ceil=navEl?navEl.offsetTop+navEl.offsetHeight+18:0;
  return {cw:cw,ch:ch,bx:bx,by:by,bw:bw,bh:bh,px:px,py:py,floor:floor,ceil:ceil,fade:(stacked&&!rail.hidden)?40:0};
}
function applyHero(r){
  if(!H||!r.bw||!r.bh)return;
  /* the same object-fit: cover math the video uses, inside the video's own box */
  var VW=v.videoWidth||H.vw, VH=v.videoHeight||H.vh;
  var s=Math.max(r.bw/VW,r.bh/VH), w=VW*s, h=VH*s;
  geo.cw=r.cw;geo.ch=r.ch;geo.s=s;geo.floor=r.floor;geo.ceil=r.ceil;geo.fade=r.fade;geo.mask=null;
  geo.map={x:r.bx+(r.bw-w)*r.px, y:r.by+(r.bh-h)*r.py, kx:w/1000, ky:h/1000};
  geo.headR=H.headPx*s;
  geo.dpr=sizeCanvas(hcv,r.cw,r.ch,5.2e6);
  dirty=null;heroDirty=true;
}
function drawHero(f){
  var c=hctx, g=geo, m=g.map, k=clamp(g.s,.55,1.7), i, x, y;
  c.setTransform(g.dpr,0,0,g.dpr,0,0);
  if(dirty)c.clearRect(dirty[0],dirty[1],dirty[2],dirty[3]);else c.clearRect(0,0,g.cw,g.ch);
  pose(H.kp,f,m,P);
  var bb=[1e9,1e9,-1e9,-1e9];
  for(i=10;i<46;i+=2){x=P[i];y=P[i+1];if(x<bb[0])bb[0]=x;if(y<bb[1])bb[1]=y;if(x>bb[2])bb[2]=x;if(y>bb[3])bb[3]=y;}
  var hx=(P[6]+P[8])/2, hy=(P[7]+P[9])/2;
  if(hx-g.headR<bb[0])bb[0]=hx-g.headR;if(hy-g.headR<bb[1])bb[1]=hy-g.headR;if(hx+g.headR>bb[2])bb[2]=hx+g.headR;
  var pad=14*k, bx0=bb[0]-pad, by0=bb[1]-pad, bx1=bb[2]+pad, by1=bb[3]+pad;

  /* light trails: glove in warm white, throwing hand in gold. The gold one flares as the arm comes through after release. */
  var arm=confAt(H.conf,f);
  var fl=Math.exp(-Math.pow((f-(H.peak+2))/4.5,2));
  trail(c,H.kp,f,9,m,14,INK,.45,1.5*k,false,bb,null);
  trail(c,H.kp,f,10,m,18+Math.round(18*fl),GOLD,.92,(2.1+3.6*fl)*k,true,bb,H.conf);
  var wx=P[20], wy=P[21], age=f-H.peak, rel=(age>=-.5&&age<7)?1-Math.max(0,age)/7:0;

  /* the tracked body */
  drawBody(c,P,{rgb:GOLD,alpha:.95,lw:clamp(1+.45*k,1.2,1.9),headR:g.headR,dot:clamp(1.6+.9*k,2,3.1),under:.42,arm:arm});
  c.fillStyle='rgba('+GOLD+',.95)';c.beginPath();
  for(i=34;i<46;i+=2){c.moveTo(P[i]+1.4,P[i+1]);c.arc(P[i],P[i+1],1.4,0,TAU);}
  c.fill();
  /* throwing hand marker */
  if(arm>.02){c.strokeStyle='rgba('+GOLD+','+arm.toFixed(3)+')';c.lineWidth=1.2;c.beginPath();c.arc(wx,wy,6.5*k,0,TAU);c.stroke();}

  /* on tall screens the figure fades into the floor with the film */
  if(g.fade&&bb[3]+pad>g.floor-g.fade){
    if(!g.mask){g.mask=c.createLinearGradient(0,g.floor-g.fade,0,g.floor);g.mask.addColorStop(0,'rgba(0,0,0,0)');g.mask.addColorStop(1,'rgba(0,0,0,1)');}
    c.globalCompositeOperation='destination-out';
    c.fillStyle=g.mask;c.fillRect(0,g.floor-g.fade,g.cw,g.fade);
    c.fillStyle='#000';c.fillRect(0,g.floor,g.cw,g.ch-g.floor);
    c.globalCompositeOperation='source-over';
  }

  /* tracker brackets and frame number */
  var L=(11+7*rel)*k;
  if(by0<g.ceil)by0=g.ceil;
  if(by1>g.floor)by1=g.floor;
  if(by1<by0+2*L)by1=by0+2*L;
  c.strokeStyle='rgba('+GOLD+','+(.72+.28*rel).toFixed(2)+')';c.lineWidth=1+rel*.8;c.lineCap='butt';c.lineJoin='miter';c.beginPath();
  c.moveTo(bx0,by0+L);c.lineTo(bx0,by0);c.lineTo(bx0+L,by0);
  c.moveTo(bx1-L,by0);c.lineTo(bx1,by0);c.lineTo(bx1,by0+L);
  c.moveTo(bx1,by1-L);c.lineTo(bx1,by1);c.lineTo(bx1-L,by1);
  c.moveTo(bx0+L,by1);c.lineTo(bx0,by1);c.lineTo(bx0,by1-L);
  c.stroke();
  c.font='500 10px '+MONO;c.fillStyle='rgba('+GOLD+',.95)';
  c.textBaseline='bottom';c.fillText('TRACKING  '+H.points+' POINTS',Math.max(bx0,12),by0-7);
  c.fillText(rel>0?'RELEASE':'FRAME '+pad3(Math.round(f)),Math.max(bx0+L+8,12),by1-3);

  var ex=Math.max(64,70*k);
  if(bb[0]>bx0)bb[0]=bx0;if(bb[1]>by0)bb[1]=by0;if(bb[2]<bx1)bb[2]=bx1;if(bb[3]<by1)bb[3]=by1;
  if(bb[2]<bx0+170)bb[2]=bx0+170;
  dirty=[Math.floor(bb[0]-ex),Math.floor(bb[1]-ex),Math.ceil(bb[2]-bb[0]+2*ex),Math.ceil(bb[3]-bb[1]+2*ex)];
}
function heroTick(now){
  if(!heroOK)return;
  var want=!userPaused&&heroVis&&!ptrDown&&!kbFocus&&now>holdUntil&&!D.hidden;
  if(want){
    if(v.playbackRate!==.5)v.playbackRate=.5;
    if(v.paused&&!playPending){
      playPending=true;
      var pr;try{pr=v.play();}catch(e){pr=null;}
      if(pr&&pr.then){pr.then(function(){playPending=false;},function(err){playPending=false;if(err&&err.name==='NotAllowedError'){userPaused=true;syncPP();}});}
      else playPending=false;
    }
  }else if(!v.paused){v.pause();}
  if(!heroVis)return;
  var t=v.currentTime||0;
  /* while playing, follow the frame that is actually on screen */
  if(vfT>=0&&!v.paused&&!v.seeking&&Math.abs(vfT-t)<.25)t=vfT;
  /* the video frame on screen, then the pose that belongs to it: pose frame = seconds x 30, whatever the playback speed.
     Odd video frames fall halfway between two poses and are interpolated. */
  var k=clamp(Math.floor(t*VF+.25),0,kMax);
  if(k===lastK&&!heroDirty)return;
  lastK=k;heroDirty=false;
  var f=clamp(k/VF*H.fps,0,H.frames-1);
  drawHero(f);
  if(!ptrDown)seek.value=String(k);
  fill.style.transform='scaleX('+(k/kMax).toFixed(4)+')';
  var dt=k/VF-H.peak/H.fps, s=Math.abs(dt).toFixed(2);
  var txt=Math.abs(dt)<.004?' 00.00 s at release':(dt<0?'-':'+')+(s.length<5?'0'+s:s)+(dt<0?' s to release':' s after release');
  if(txt!==tcTxt){tc.textContent=txt;tcTxt=txt;}
  var pi=phaseAt(f);
  if(pi!==phIdx){
    ph.textContent=phases[pi].n;
    if(tickLis[phIdx])tickLis[phIdx].classList.remove('on');
    if(tickLis[pi])tickLis[pi].classList.add('on');
    phIdx=pi;
  }
}
function initHero(data){
  H=data.hero;
  if(!H||!H.kp||!H.kp.length||v.error){heroPlain();return;}
  H.frames=H.kp.length;H.points=(data.joints&&data.joints.length)||23;
  H.peak=clamp(H.peak||0,0,H.frames-1);
  H.headPx=headUnits(H.kp,H.vw/1000,H.vh/1000);
  H.conf=armConf(H.kp,H.peak,H.vw/1000,H.vh/1000);
  findPhases();buildRail();
  heroOK=true;needMeasure=true;
}

/* ---------- manifesto: words light up with scroll ---------- */
var mani=$('#mani'), words=[], lit=0, mStart=0, mEnd=1;
if(!reduced){
  (function split(node){
    var kids=Array.prototype.slice.call(node.childNodes);
    kids.forEach(function(n){
      if(n.nodeType===3){
        var parts=n.nodeValue.split(/(\s+)/), frag=D.createDocumentFragment();
        parts.forEach(function(p){
          if(!p)return;
          if(/^\s+$/.test(p)){frag.appendChild(D.createTextNode(' '));return;}
          var s=D.createElement('span');s.className='w';s.textContent=p;frag.appendChild(s);words.push(s);
        });
        node.replaceChild(frag,n);
      }else if(n.nodeType===1){split(n);}
    });
  })(mani);
  mani.classList.add('split');
}
function maniUpdate(y){
  if(!words.length)return;
  var n=Math.round(clamp((y-mStart)/(mEnd-mStart),0,1)*words.length), i;
  if(n===lit)return;
  if(n>lit){for(i=lit;i<n;i++)words[i].classList.add('on');}
  else{for(i=n;i<lit;i++)words[i].classList.remove('on');}
  lit=n;
}

/* ---------- a season on film: pinned chapters ---------- */
var reelsEl=$('#reels'), reelEls=$$('.reel',reelsEl), reelIn=reelEls.map(function(r){return $('.reel__in',r);});
var reelTop=[], reelC=[], stickyMQ=W.matchMedia?W.matchMedia('(min-width:900px) and (min-height:600px)'):{matches:false};
function reelsUpdate(y){
  var on=stickyMQ.matches&&!reduced, i, c;
  for(i=0;i<reelEls.length-1;i++){
    c=on?clamp((y+vh-reelTop[i+1])/vh,0,1):0;
    if(Math.abs(c-(reelC[i]||0))>.002||(c===0&&reelC[i])){reelC[i]=c;reelIn[i].style.setProperty('--c',c.toFixed(3));}
  }
}

/* ---------- who: one line that travels with the scroll ---------- */
var who=$('#who'), whoLine=$('#whoLine'), whoTop=0, whoH=1, whoW=0, whoX=null;
function whoUpdate(y){
  if(reduced||!whoW)return;
  var p=(y+vh-whoTop)/(vh+whoH);
  if(p<-.05||p>1.05)return;
  p=clamp(p,0,1);
  var x=Math.round(vw*.16+(-(whoW-vw*.8)-vw*.16)*p);
  if(x!==whoX){whoX=x;whoLine.style.transform='translate3d('+x+'px,0,0)';}
}

/* ---------- tip detection figure ---------- */
var T={cv:$('#tipc'),ctx:null,set:null,ok:false,vis:false,clock:0,last:0,dirty:true,P:new Float32Array(46),geo:null,F0:30,peak:80,fps:30,shown:false};
var tell=$('#tell');
T.ctx=T.cv.getContext('2d');
function applyTip(cw,ch){
  if(!T.ok||!cw||!ch)return;
  var left=cw/ch>1.1, g=fitFigure(T.set,cw,ch,left?cw*.04:14,18,26,left);
  g.cw=cw;g.ch=ch;g.dpr=sizeCanvas(T.cv,cw,ch,4e6);
  g.headR=T.set.headU*g.s;g.lw=clamp(1.1+g.s*1.7,1.4,2.4);g.dot=clamp(1.6+g.s*2.8,2.2,3.6);
  g.ring=clamp(g.s*34,13,24);g.ghost=g.s*36;g.gy=ch-26+5;
  at(T.set.kp,T.F0,9,g);
  var rx=tx, ry=ty, right=(cw-rx)>=Math.max(70,cw*.16)+190;
  g.right=right;
  g.ax=right?rx+Math.max(70,cw*.16):rx-46;
  g.ay=right?ry-ch*.17:Math.max(8,ry-74);
  T.geo=g;T.dirty=true;
  tell.classList.toggle('is-l',!right);
  tell.style.setProperty('--ax',Math.round(g.ax)+'px');
  tell.style.setProperty('--ay',Math.round(g.ay)+'px');
  tell.style.setProperty('--aw',Math.round(right?cw-g.ax:g.ax)+'px');
}
function drawTip(f,hold){
  var c=T.ctx, g=T.geo, Pt=T.P;
  c.setTransform(g.dpr,0,0,g.dpr,0,0);c.clearRect(0,0,g.cw,g.ch);
  c.strokeStyle='rgba('+INK+',.16)';c.lineWidth=1;c.beginPath();c.moveTo(0,g.gy);c.lineTo(g.cw,g.gy);c.stroke();
  /* film-room readout: where this frame sits against release */
  var dt=(f-T.peak)/T.fps;
  c.font='500 10px '+MONO;c.textBaseline='top';c.fillStyle='rgba('+INK+',.62)';
  c.fillText('FRAME '+pad3(Math.round(f))+'   '+(dt<0?'-':'+')+Math.abs(dt).toFixed(2)+' S '+(dt<0?'TO':'AFTER')+' RELEASE',0,2);
  if(hold>.5){c.fillStyle='rgba('+GOLD+','+hold.toFixed(3)+')';c.fillText('HOLD',0,18);}
  var dim=1-hold*.62;
  if(hold<1){trail(c,T.set.kp,f,10,g,14,INK,.5*(1-hold),1.7,false,null,T.set.conf);trail(c,T.set.kp,f,9,g,10,INK,.3*(1-hold),1.3,false,null,null);}
  pose(T.set.kp,f,g,Pt);
  drawBody(c,Pt,{rgb:INK,alpha:(.92*dim).toFixed(3),lw:g.lw,headR:g.headR,dot:g.dot,arm:confAt(T.set.conf,f)});
  if(hold>0){
    var x=Pt[18], y=Pt[19], R=g.ring, y2=y-g.ghost, side=g.right?-1:1, mx=x+side*(R+11);
    c.lineCap='round';
    c.strokeStyle='rgba('+GOLD+','+hold.toFixed(3)+')';c.lineWidth=g.lw+.7;bonePath(c,Pt,[[5,7],[7,9]]);c.stroke();
    c.setLineDash([3,4]);c.strokeStyle='rgba('+INK+','+(.8*hold).toFixed(3)+')';c.lineWidth=1;c.beginPath();c.arc(x,y2,R,0,TAU);c.stroke();c.setLineDash([]);
    c.strokeStyle='rgb('+GOLD+')';c.lineWidth=2;c.beginPath();c.arc(x,y,R,-1.5708,-1.5708+TAU*hold);c.stroke();
    c.lineWidth=1;c.strokeStyle='rgba('+GOLD+','+hold.toFixed(3)+')';c.beginPath();
    c.moveTo(mx-4,y2);c.lineTo(mx+4,y2);c.moveTo(mx,y2);c.lineTo(mx,y);c.moveTo(mx-4,y);c.lineTo(mx+4,y);
    var dx=g.ax-x, dy=g.ay-y, d=Math.sqrt(dx*dx+dy*dy)||1, sx=x+dx/d*R, sy=y+dy/d*R;
    c.moveTo(sx,sy);c.lineTo(sx+(g.ax-sx)*hold,sy+(g.ay-sy)*hold);
    c.stroke();
  }
}
function tipTick(now){
  if(!T.ok||!T.geo)return;
  if(reduced){if(T.dirty){drawTip(T.F0,1);T.dirty=false;if(!T.shown){tell.classList.add('show');T.shown=true;}}return;}
  if(!T.vis){T.last=0;return;}
  var dt=T.last?Math.min(now-T.last,50)/1000:0;T.last=now;T.clock+=dt;
  var n=T.set.kp.length-1, sp=15, A=T.F0/sp, B=5.2, C=(n-T.F0)/sp, E=1, t=T.clock%(A+B+C+E), f, hold=0, show=false;
  if(t<A){f=t*sp;}
  else if(t<A+B){f=T.F0;hold=clamp((t-A)/.7,0,1)*clamp((A+B-t)/.45,0,1);hold=hold*hold*(3-2*hold);show=t>A+.35&&t<A+B-.45;}
  else if(t<A+B+C){f=T.F0+(t-A-B)*sp;}
  else{f=n;}
  drawTip(f,hold);
  if(show!==T.shown){tell.classList.toggle('show',show);T.shown=show;}
}

/* ---------- center-field figure (all winter) ---------- */
var C={cv:$('#cf'),ctx:null,set:null,ok:false,vis:false,clock:0,last:0,dirty:true,P:new Float32Array(46),G:new Float32Array(46),geo:null,n:-1};
var cfN=$('#cfN');
C.ctx=C.cv.getContext('2d');
function applyCf(cw,ch){
  if(!C.ok||!cw||!ch)return;
  var g=fitFigure(C.set,cw,ch,14,16,26,false);
  g.cw=cw;g.ch=ch;g.dpr=sizeCanvas(C.cv,cw,ch,4e6);
  g.headR=C.set.headU*g.s;g.lw=clamp(1+g.s*1.2,1.2,2);g.dot=clamp(1.4+g.s*2.4,2,3.2);g.gy=ch-26+5;
  C.geo=g;C.dirty=true;
}
function drawCf(f){
  var c=C.ctx, g=C.geo, kp=C.set.kp, k, fg;
  c.setTransform(g.dpr,0,0,g.dpr,0,0);c.clearRect(0,0,g.cw,g.ch);
  c.strokeStyle='rgba('+INK+',.16)';c.lineWidth=1;c.beginPath();c.moveTo(0,g.gy);c.lineTo(g.cw,g.gy);c.stroke();
  for(k=5;k>=1;k--){
    fg=f-k*7; if(fg<0)continue;
    pose(kp,fg,g,C.G);
    drawBody(c,C.G,{rgb:INK,alpha:(.06+.055*(5-k)).toFixed(3),lw:g.lw*.8,headR:g.headR,dot:0,arm:confAt(C.set.conf,fg)});
  }
  trail(c,kp,f,10,g,18,GOLD,.85,2,true,null,C.set.conf);
  pose(kp,f,g,C.P);
  drawBody(c,C.P,{rgb:GOLD,alpha:.95,lw:g.lw,headR:g.headR,dot:g.dot,arm:confAt(C.set.conf,f)});
  var n=Math.round(f);
  if(n!==C.n){C.n=n;cfN.textContent='Frame '+pad3(n);}
}
function cfTick(now){
  if(!C.ok||!C.geo)return;
  if(reduced){if(C.dirty){drawCf(Math.min(74,C.set.kp.length-1));C.dirty=false;}return;}
  if(!C.vis){C.last=0;return;}
  var dt=C.last?Math.min(now-C.last,50)/1000:0;C.last=now;C.clock+=dt;
  var n=C.set.kp.length-1, sp=15, run=n/sp, t=C.clock%(run+1.4);
  drawCf(t<run?t*sp:n);
}

/* ---------- visibility: pause what is off screen ---------- */
if(io){
  var vio=new IntersectionObserver(function(es){es.forEach(function(e){
    var on=e.isIntersecting;
    if(e.target===hero){heroVis=on;hero.classList.toggle('is-away',!on);if(on)heroDirty=true;}
    else if(e.target===T.cv){T.vis=on;}
    else if(e.target===C.cv){C.vis=on;}
  });},{rootMargin:'60px 0px'});
  vio.observe(hero);vio.observe(T.cv);vio.observe(C.cv);
}else{T.vis=true;C.vis=true;}

/* ---------- measure (all reads, then all writes) ---------- */
function measure(){
  var y=W.pageYOffset||0, i, r;
  vw=root.clientWidth;vh=W.innerHeight;
  var hr=measureHero();
  r=mani.getBoundingClientRect();
  var mTop=r.top+y, mH=r.height;
  var rTop=reelsEl.getBoundingClientRect().top+y, rH=reelEls.map(function(el){return el.offsetHeight;});
  r=who.getBoundingClientRect();
  var wTop=r.top+y, wH=r.height, wW=whoLine.offsetWidth;
  var tw=T.cv.clientWidth, th=T.cv.clientHeight, cw=C.cv.clientWidth, ch=C.cv.clientHeight;
  /* writes */
  mStart=mTop-vh*.82;mEnd=mTop+mH-vh*.52;if(mEnd<=mStart)mEnd=mStart+1;
  var acc=rTop;
  for(i=0;i<reelEls.length;i++){reelTop[i]=acc;acc+=rH[i];reelEls[i].style.setProperty('--stick',Math.min(0,vh-rH[i])+'px');}
  whoTop=wTop;whoH=wH;whoW=wW;whoX=null;
  applyHero(hr);applyTip(tw,th);applyCf(cw,ch);
}
W.addEventListener('resize',function(){needMeasure=true;},{passive:true});
W.addEventListener('orientationchange',function(){needMeasure=true;},{passive:true});
W.addEventListener('load',function(){needMeasure=true;});
if(D.fonts&&D.fonts.ready&&D.fonts.ready.then)D.fonts.ready.then(function(){needMeasure=true;});
if(mq.addEventListener)mq.addEventListener('change',function(){W.location.reload();});

/* ---------- the one loop ---------- */
function frame(now){
  if(needMeasure){needMeasure=false;measure();force=true;}
  var y=W.pageYOffset||0;
  heroTick(now);
  if(y!==lastY||force){lastY=y;force=false;maniUpdate(y);reelsUpdate(y);whoUpdate(y);}
  tipTick(now);cfTick(now);gradesTick(now);
  W.requestAnimationFrame(frame);
}
W.requestAnimationFrame(frame);

/* ---------- data ---------- */
function figuresOff(){var a=$('#tipFig'),b=$('#cfFig');if(a)a.hidden=true;if(b)b.hidden=true;}
function initFigures(data){
  if(data.hitter&&data.hitter.kp&&data.hitter.kp.length){
    T.set=data.hitter;T.set.headU=headUnits(T.set.kp,1,1);T.F0=Math.min(30,T.set.kp.length-1);
    T.peak=clamp(T.set.peak||80,0,T.set.kp.length-1);T.fps=T.set.fps||30;
    T.set.conf=armConf(T.set.kp,T.peak,1,1);T.ok=true;
  }
  else{var a=$('#tipFig');if(a)a.hidden=true;}
  if(data.cf&&data.cf.kp&&data.cf.kp.length){
    C.set=data.cf;C.set.headU=headUnits(C.set.kp,1,1);
    C.set.conf=armConf(C.set.kp,clamp(C.set.peak||80,0,C.set.kp.length-1),1,1);C.ok=true;
  }
  else{var b=$('#cfFig');if(b)b.hidden=true;}
  needMeasure=true;
}
if(W.fetch){
  W.fetch('./media/delivery.json').then(function(r){if(!r.ok)throw new Error('data');return r.json();})
    .then(function(data){
      try{initHero(data);}catch(e){heroPlain();}
      try{initFigures(data);}catch(e){figuresOff();}
    })
    .catch(function(){heroPlain();figuresOff();});
}else{heroPlain();figuresOff();}
})();
