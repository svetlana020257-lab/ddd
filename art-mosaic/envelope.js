const $=id=>document.getElementById(id);
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const CFG=window.ENV;
const D=CFG.decode(new URLSearchParams(location.search).get(CFG.param)||'');
if(!D){
  $('main').innerHTML='<div class="err"><h1>Ссылка не открылась</h1><p>Похоже, ссылка скопировалась не целиком. Попросите прислать её ещё раз. Мастерская Art Mosaic: +7 913 002-95-52.</p></div>';
} else start();

async function start(){
  const key='f_'+(AM.DESIGNS.find(d=>d[0]===D.design)||D.design==='brand'?D.design:CFG.defaultDesign);
  $('envimg').src=AM.img(key);
  const single=typeof CFG.single==='function'?CFG.single(D):!!CFG.single;
  if(single){
    if(!$('ci')){$('flip').innerHTML='<span class="inner"><span class="face a"><canvas id="ci" width="2481" height="1419"></canvas></span></span>';
      $('flip').style.cursor='default';['turn','fliphint'].forEach(id=>{const e=$(id);if(e)e.style.display='none'});}
    await CFG.fonts();const fr=await AM.load(AM.img(key));
    CFG.drawSingle($('ci'),fr,D);document.fonts.ready.then(()=>CFG.drawSingle($('ci'),fr,D));
  }else{
    const [fr,bk]=await Promise.all([AM.load(AM.img(key)),AM.load(AM.img(CFG.backImg)),CFG.fonts()]);
    AM.drawFront($('cf'),fr);CFG.drawBack($('cb'),bk,D);
    document.fonts.ready.then(()=>CFG.drawBack($('cb'),bk,D));
    $('flip').addEventListener('click',()=>$('flip').classList.toggle('turned'));
    $('turn').addEventListener('click',()=>$('flip').classList.toggle('turned'));
  }
  if(CFG.after)CFG.after(D);
  let opened=false;
  $('env').addEventListener('click',()=>{if(opened)return;opened=true;openEnv();});
  $('pdf').addEventListener('click',()=>{
    try{AM.download(CFG.fileName(D),single?AM.pdfInvite($('ci')):AM.pdfOne($('cf'),$('cb')))}catch(e){console.error(e);$('fliphint').textContent='Не получилось сохранить PDF: '+e.message}
  });
}

function wait(ms){return new Promise(r=>setTimeout(r,reduce?0:ms))}
async function openEnv(){
  const env=$('env');env.classList.remove('idle');$('tap').style.opacity=0;
  env.classList.add('open');await wait(380);
  const r=env.getBoundingClientRect();burst(r.left+r.width/2,r.top+r.height*.35);
  env.classList.add('rise');await wait(850);
  // FLIP: от карточки в конверте к большой карточке
  const from=$('envcard').getBoundingClientRect();
  env.classList.add('gone');await wait(250);
  env.style.display='none';$('tap').style.display='none';
  $('result').hidden=false;
  const to=$('flip').getBoundingClientRect();
  if(!reduce){
    $('flip').animate([{transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${from.width/to.width})`,transformOrigin:'0 0'},{transform:'none',transformOrigin:'0 0'}],{duration:700,easing:'cubic-bezier(.2,.8,.2,1)'});
    burst(to.left+to.width/2,to.top+to.height*.4,90);
  }
  document.querySelectorAll('.result>:not(.flip)').forEach((el,i)=>{el.classList.add('fade-in');el.style.animationDelay=(.5+i*.08)+'s'});
}

// конфетти: мозаичные осколки + кружочки
const cv=$('confetti'),cx=cv.getContext('2d');let parts=[],raf=0;
function size(){const d=devicePixelRatio||1;cv.width=innerWidth*d;cv.height=innerHeight*d;cx.setTransform(d,0,0,d,0,0)}
size();addEventListener('resize',size);
const COLS=['#E23C80','#F27AAA','#7A2E92','#A458BD','#7C7CFF','#FFD92B','#F7841E','#FFFFFF'];
function burst(x,y,n=160){
  if(reduce)return;
  for(let i=0;i<n;i++){const a=-Math.PI/2+(Math.random()-.5)*Math.PI*1.25,v=6+Math.random()*9;
    parts.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,r:Math.random()*Math.PI*2,vr:(Math.random()-.5)*.3,s:5+Math.random()*9,
      c:COLS[(Math.random()*COLS.length)|0],t:Math.random()<.45?0:Math.random()<.6?1:2,life:0,w:Math.random()*Math.PI*2});}
  if(!raf)raf=requestAnimationFrame(tick);
}
function tick(){
  cx.clearRect(0,0,innerWidth,innerHeight);
  parts=parts.filter(p=>p.y<innerHeight+40&&p.life<360);
  for(const p of parts){p.life++;p.vy+=.22;p.vx*=.985;p.vy*=.985;p.x+=p.vx+Math.sin(p.w+p.life*.08)*.6;p.y+=p.vy;p.r+=p.vr;
    cx.save();cx.translate(p.x,p.y);cx.rotate(p.r);cx.scale(1,Math.abs(Math.cos(p.life*.1+p.w))*.7+.3);cx.fillStyle=p.c;
    if(p.c==='#FFFFFF'){cx.strokeStyle='#F2C3D7';cx.lineWidth=1}
    cx.beginPath();
    if(p.t===0)cx.rect(-p.s/2,-p.s/2,p.s,p.s);
    else if(p.t===1){cx.moveTo(-p.s/2,p.s/2);cx.lineTo(p.s/2,p.s/2);cx.lineTo(0,-p.s/2);cx.closePath()}
    else cx.arc(0,0,p.s*.35,0,Math.PI*2);
    cx.fill();if(p.c==='#FFFFFF')cx.stroke();cx.restore();}
  raf=parts.length?requestAnimationFrame(tick):0;
}
