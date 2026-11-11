import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Score, ScoreEvent, Turn, View, Value } from './types';

const TAU=Math.PI*2;
const palette=['#a6ecd3','#eaa381','#9eacfa','#dfc774','#9bcbe7','#dd97bf','#8fbaa3','#a2aab8'];
const namedColours:Record<string,string>={triangle:'#a6ecd3',sawtooth:'#eaa381',sine:'#dca3d1',bd:'#a4a6f5',sd:'#f1bb77',hh:'#89c4e2',value:'#b3bbc6',breaks:'#d7bd7b',voice:'#a6d6d2'};
export const colourFor=(name:string):string=>namedColours[name]??palette[hash(name)%palette.length]??'#a6ecd3';
function hash(text:string):number { let n=0;for(const c of text)n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;return n; }
const clamp=(x:number,a:number,b:number)=>Math.min(b,Math.max(a,x));
interface Buffers { positions:number[]; colours:number[] }
export interface CellInfo { count:number; begin:number; end:number }
interface RenderEntry { event:ScoreEvent; begin:number; end:number; count:number; gain:number }
interface PickPoint { p:THREE.Vector3; event:ScoreEvent; cycle:number; cell?:CellInfo }
interface Tag { element:HTMLSpanElement; point:THREE.Vector3 }
export class SpiralScene {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(42,1,.1,3000);
  readonly controls:OrbitControls;
  readonly root=new THREE.Group();
  readonly cursor=new THREE.Group();
  view:View='ring'; detail='auto'; solo:string|null=null; score:Score|null=null; focus=0; drawn=0; aggregated=0;
  #stage:HTMLElement; #labels:HTMLElement; #tags:Tag[]=[]; #picks:PickPoint[]=[];
  #spacing=1.75; #start=0; #cycle=0; #pointer=new THREE.Vector2();
  #guides:Buffers|null=null; #near=false; #hasPitch=false;
  #sounds:string[]=[]; #minPitch=24; #maxPitch=96; #width=0; #height=0;
  constructor(stage:HTMLElement,labels:HTMLElement,onHover:(event:ScoreEvent|null,x:number,y:number,cell?:CellInfo)=>void) {
    this.#stage=stage;this.#labels=labels;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance',preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
    this.renderer.setClearColor('#101720',0);
    stage.prepend(this.renderer.domElement);
    this.scene.add(this.root,this.cursor);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.12;
    this.controls.enablePan=true;this.controls.minDistance=2;this.controls.maxDistance=600;
    this.controls.addEventListener('start',()=>onHover(null,0,0));
    this.controls.addEventListener('end',()=>{const near=this.camera.position.distanceTo(this.controls.target)<12;if(near!==this.#near){this.#near=near;this.rebuild();}});
    this.controls.touches.ONE=THREE.TOUCH.ROTATE;this.controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    this.renderer.domElement.addEventListener('pointermove',event=>{
      if(event.buttons)return;
      const bounds=this.renderer.domElement.getBoundingClientRect();
      this.#pointer.set(event.clientX-bounds.left,event.clientY-bounds.top);
      let best:PickPoint|undefined;let distance=15;
      for(const p of this.#picks) {
        const v=p.p.clone().project(this.camera);if(v.z>1||v.z< -1)continue;
        const d=Math.hypot((v.x+1)*this.#width/2-this.#pointer.x,(-v.y+1)*this.#height/2-this.#pointer.y);
        if(d<distance){best=p;distance=d;}
      }
      onHover(best?.event??null,this.#pointer.x,this.#pointer.y,best?.cell);
    });
    this.renderer.domElement.addEventListener('pointerleave',()=>onHover(null,0,0));
    new ResizeObserver(()=>this.resize()).observe(stage);
    this.resize();
  }
  resize() {this.#width=this.#stage.clientWidth;this.#height=this.#stage.clientHeight;this.renderer.setSize(this.#width,this.#height);this.camera.aspect=this.#width/Math.max(1,this.#height);this.camera.updateProjectionMatrix();}
  #point(time:number,r:number,cycle:number):THREE.Vector3 {
    const local=time-cycle;
    const angle=Math.PI/2-local*TAU;
    if(this.view==='ring') {
      const delta=cycle-this.focus;
      return new THREE.Vector3(Math.cos(angle)*(r+delta*.23),Math.sin(angle)*(r+delta*.23),-Math.abs(delta)*.15);
    }
    return new THREE.Vector3(Math.cos(angle)*r,Math.sin(angle)*r,-(time-this.#start)*this.#spacing);
  }
  #radius(e:ScoreEvent):number {
    if(e.pitch!==null)return 3.4+clamp((e.pitch-this.#minPitch)/(this.#maxPitch-this.#minPitch),0,1)*3.5;
    if(e.sound==='value') {
      const v=typeof e.value==='object'?JSON.stringify(e.value):String(e.value);
      return 3.5+(hash(v)%8)*.38;
    }
    return 2.05+Math.max(0,this.#sounds.filter(s=>s!=='value').indexOf(e.sound))*.24;
  }
  #dispose(group:THREE.Group) {
    group.traverse(obj=>{if(obj instanceof THREE.Mesh||obj instanceof THREE.LineSegments||obj instanceof THREE.Line){obj.geometry.dispose();const m=obj.material;if(Array.isArray(m))m.forEach(m=>m.dispose());else m.dispose();}});
    group.clear();
  }
  #line(points:THREE.Vector3[],colour:string,opacity:number,group:THREE.Group=this.root) {
    if(group===this.root&&this.#guides){
      const c=new THREE.Color('#192a35').lerp(new THREE.Color(colour),opacity);
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a&&b){this.#guides.positions.push(...a.toArray(),...b.toArray());this.#guides.colours.push(c.r,c.g,c.b,c.r,c.g,c.b);}}
      return;
    }
    const g=new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:colour,transparent:true,opacity,depthWrite:false})));
  }
  #tri(b:Buffers,a:THREE.Vector3,c:THREE.Vector3,d:THREE.Vector3,colour:THREE.Color) {
    b.positions.push(...a.toArray(),...c.toArray(),...d.toArray());
    for(let i=0;i<3;i++)b.colours.push(colour.r,colour.g,colour.b);
  }
  #ribbon(b:Buffers,begin:number,end:number,r:number,width:number,colour:THREE.Color,cycle:number) {
    if(end<=begin)return;
    const steps=Math.max(1,Math.ceil((end-begin)*100));
    for(let i=0;i<steps;i++) {
      const a=begin+(end-begin)*i/steps,c=begin+(end-begin)*(i+1)/steps;
      const p=this.#point(a,r-width,cycle),q=this.#point(a,r+width,cycle),u=this.#point(c,r-width,cycle),v=this.#point(c,r+width,cycle);
      this.#tri(b,p,q,u,colour);this.#tri(b,q,v,u,colour);
    }
  }
  #head(b:Buffers,time:number,end:number,r:number,width:number,colour:THREE.Color,cycle:number) {
    // The nose stays inside the score span, including sub-pixel dense notes.
    const length=Math.min(.006,Math.max(0,end-time)*.7);
    this.#tri(b,this.#point(time,r,cycle),this.#point(time+length,r-width*1.9,cycle),this.#point(time+length,r+width*1.9,cycle),colour);
  }
  #mesh(b:Buffers,opacity:number) {
    if(!b.positions.length)return;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(b.colours,3));
    const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity,depthWrite:false});
    this.root.add(new THREE.Mesh(geometry,material));
  }
  #aggregate(events:ScoreEvent[]):{entries:RenderEntry[]; reduced:number} {
    const cells=new Map<string,RenderEntry>();
    for(const e of events) {
      const cycle=Math.floor(e.partBegin),bin=Math.floor((e.partBegin-cycle)*64);
      const key=`${e.sound}:${e.pitch===null?'drum':Math.floor(e.pitch/3)}:${bin}`;
      const prev=cells.get(key);
      if(prev){prev.count++;prev.gain=Math.min(1.8,prev.gain+.08);}
      else cells.set(key,{event:e,count:1,gain:e.gain,begin:cycle+bin/64,end:cycle+(bin+1)/64});
    }
    return {entries:[...cells.values()],reduced:events.length-cells.size};
  }
  setScore(score:Score) {this.score=score;this.#start=score.turns[0]?.cycle??0;this.focus=this.#start;this.#cycle=this.focus;this.#sounds=[...new Set(score.turns.flatMap(t=>t.events.map(e=>e.sound)))].sort();
    const pitches=score.turns.flatMap(t=>t.events.flatMap(e=>e.pitch===null?[]:[e.pitch]));
    this.#hasPitch=pitches.length>0;
    this.#minPitch=pitches.length?Math.floor(pitches.reduce((min,p)=>Math.min(min,p),Infinity)/12)*12:24;
    this.#maxPitch=pitches.length?Math.max(this.#minPitch+24,Math.ceil(pitches.reduce((max,p)=>Math.max(max,p),-Infinity)/12)*12):96;
    this.rebuild();this.resetCamera();}
  setView(view:View) {this.view=view;this.rebuild();this.resetCamera();}
  setFocus(cycle:number) {this.focus=cycle;this.#cycle=cycle;this.rebuild();this.resetCamera();}
  setDetail(detail:string){this.detail=detail;this.rebuild();}
  setSolo(sound:string|null){this.solo=sound;this.rebuild();}
  visibleTurns():Turn[] {
    if(!this.score)return [];
    return this.score.turns.filter(t=>this.view==='ring'?Math.abs(t.cycle-this.focus)<=1:this.view==='fly'?t.cycle>=this.focus-1&&t.cycle<this.focus+14:true);
  }
  rebuild() {
    this.#dispose(this.root);this.#picks=[];this.#tags=[];this.#labels.replaceChildren();this.drawn=0;this.aggregated=0;
    if(!this.score)return;
    this.#guides={positions:[],colours:[]};
    for(const t of this.visibleTurns()) {
      const delta=t.cycle-this.focus;
      const opacity=this.view==='ring'?(delta===0?1:.15):this.view==='fly'?clamp(1-Math.abs(delta)/18,.12,1):.85;
      // Guides use the same helix as the events, so adjacent turns really connect in 3D.
      for(const r of [1.7,3.05,4.2,5.25,6.3,7.4]) {
        const pts=Array.from({length:129},(_,i)=>this.#point(t.cycle+i/128,r,t.cycle));
        this.#line(pts,r===7.4&&t.changed?'#c79559':'#35505d',opacity*(r===7.4?.5:.25));
      }
      for(let q=0;q<16;q++) {
        const time=t.cycle+q/16;
        this.#line([this.#point(time,1.7,t.cycle),this.#point(time,q%4===0?7.4:1.9,t.cycle)],'#39505d',opacity*(q%4===0?.3:.5));
      }
      const b:Buffers={positions:[],colours:[]};
      const useLod=this.detail==='auto'&&!this.#near&&t.events.length>128;
      const source=useLod?this.#aggregate(t.events):{entries:t.events.map(event=>({event,begin:event.partBegin,end:event.partEnd,count:1,gain:event.gain})),reduced:0};
      this.aggregated+=source.reduced;
      const tracks=new Map<string,number[]>();
      for(const entry of source.entries) {
        const e=entry.event;
        let r=this.#radius(e);
        const key=`${e.sound}:${e.pitch??r}`;const ends=tracks.get(key)??[];
        let track=ends.findIndex(end=>end<=entry.begin+1e-8);if(track<0)track=ends.length;
        ends[track]=entry.end;tracks.set(key,ends);
        r+=track*.055;
        const width=(.025+.055*Math.sqrt(clamp(entry.gain,0,2)))*(useLod?.75:1);
        const brightness=.36+.64*clamp(Math.log2(Math.max(80,e.cutoff)/80)/7,0,1);
        const color=new THREE.Color(colourFor(e.sound)).multiplyScalar(brightness*(e.onset||useLod?1:.48)*(this.solo && e.sound !== this.solo ? .12 : 1));
        // Full duration is split across queried parts. Only the actual onset gets a head.
        this.#ribbon(b,entry.begin+(useLod?.0015:0),entry.end-(useLod?.0015:0),r,width,color,t.cycle);
        if(e.onset&&!useLod)this.#head(b,e.begin,e.partEnd,r,width,new THREE.Color(colourFor(e.sound)).multiplyScalar(this.solo && e.sound !== this.solo ? .12 : 1),t.cycle);
        if(!e.onset&&!useLod) {
          const dots=Math.min(18,Math.ceil((e.partEnd-e.partBegin)*18));
          for(let i=0;i<dots;i++){const time=e.partBegin+(e.partEnd-e.partBegin)*(i+.5)/dots;this.#ribbon(b,time,time+.006,r,.012,new THREE.Color(colourFor(e.sound)).multiplyScalar(this.solo && e.sound !== this.solo ? .12 : 1),t.cycle);}
        }
        this.drawn++;
        this.#picks.push({p:this.#point((entry.begin+entry.end)/2,r,t.cycle),event:e,cycle:t.cycle,...(useLod?{cell:{count:entry.count,begin:entry.begin,end:entry.end}}:{})});
      }
      // Duration estimates are separate overlays, never new onsets. Carry them across seams.
      for(const parent of this.score.turns)for(const e of parent.events) {
        if(!e.onset||e.heardEnd===null||e.heardEnd<=t.cycle||e.begin>=t.cycle+1)continue;
        const end=Math.min(t.cycle+1,e.heardEnd),begin=Math.max(t.cycle,e.begin);
        for(let x=begin;x<end;x+=.025)this.#ribbon(b,x,Math.min(x+.013,end),this.#radius(e)+.14,.012,new THREE.Color('#9a9c9b'),t.cycle);
      }
      // No whole => only continuous bands. Each segment is a real sub-query sample.
      const keys=[...new Set(t.signals.flatMap(s=>Object.keys(s.settings)))].sort();
      for(const s of t.signals)for(const [key,value] of Object.entries(s.settings)) {
        const index=keys.indexOf(key);const v=typeof value==='number'?value:.5;
        const level=key==='cutoff'||key==='lpf'?clamp(Math.log2(Math.max(v,80)/80)/7,0,1):clamp(v,0,1);
        const radius=1.25+index*.5+level*.2;
        this.#ribbon(b,s.begin,s.end,radius,.026+level*.032,new THREE.Color(index%2===0?'#839ee3':'#d0a1cc').multiplyScalar(.35+.65*level),t.cycle);
      }
      this.#mesh(b,opacity);
      if((this.view==='fly'&&delta%3===0)||(this.view==='side'&&t.cycle%Math.max(1,Math.ceil(this.score.turns.length/16))===0)) {
        const label=document.createElement('span');label.className=`turn-tag${t.changed?' changed':''}`;
        label.textContent=`${String(t.cycle).padStart(2,'0')}${t.changed?' · Δ':''}`;
        this.#labels.append(label);this.#tags.push({element:label,point:this.#point(t.cycle+.25,7.7,t.cycle)});
      }
    }
    if(this.view==='ring') {
      for(const [phase,text] of [[0,'0 / start'],[.25,'¼'],[.5,'½'],[.75,'¾']] as const) {
        const element=document.createElement('span');element.className='turn-tag axis';element.textContent=text;this.#labels.append(element);this.#tags.push({element,point:this.#point(this.focus+phase,7.65,this.focus)});
      }
      for(let pitch=this.#minPitch;this.#hasPitch&&pitch<=this.#maxPitch;pitch+=12) {
        const radius=3.4+(pitch-this.#minPitch)/(this.#maxPitch-this.#minPitch)*3.5;
        const element=document.createElement('span');element.className='turn-tag pitch';element.textContent=`C${pitch/12-1}`;this.#labels.append(element);this.#tags.push({element,point:this.#point(this.focus+.87,radius,this.focus)});
      }
    }
    if(this.#guides) {
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.#guides.positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.#guides.colours,3));
      this.root.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.55,depthWrite:false})));
      this.#guides=null;
    }
    this.#dispose(this.cursor);
    this.#line([new THREE.Vector3(0,0,0),new THREE.Vector3(7.6,0,0)],'#e6f8ef',.8,this.cursor);
    const bead=new THREE.Mesh(new THREE.SphereGeometry(.065,8,8),new THREE.MeshBasicMaterial({color:'#eafff5'}));
    bead.position.x=7.6;this.cursor.add(bead);
  }
  resetCamera() {
    const count=this.score?.turns.length??12;
    const z=-(this.focus-this.#start)*this.#spacing;
    if(this.view==='ring') {
      this.controls.target.set(0,0,0);this.camera.position.set(0,.01,23);
    } else if(this.view==='fly') {
      this.controls.target.set(0,0,z-7);this.camera.position.set(1,2,z+20);
    } else {
      const center=-(count)*this.#spacing/2;
      this.controls.target.set(0,0,center);
      const distance=Math.max(8/Math.tan(21*Math.PI/180),(count*this.#spacing/2)/Math.tan(21*Math.PI/180)/this.camera.aspect)*1.2+8;
      this.camera.position.set(distance,distance*.23,center+distance*.12);
    }
    this.controls.update();
    const near=this.camera.position.distanceTo(this.controls.target)<12;if(near!==this.#near){this.#near=near;this.rebuild();}
  }
  animate(cycle:number) {
    const int=Math.floor(cycle);
    if(int!==this.focus&&this.score?.turns.some(t=>t.cycle===int)){this.focus=int;this.rebuild();if(this.view==='ring'){} }
    if(this.view==='fly') {
      const dz=-(cycle-this.#cycle)*this.#spacing;
      this.camera.position.z+=dz;this.controls.target.z+=dz;
    }
    this.#cycle=cycle;
    const angle=Math.PI/2-(cycle%1)*TAU;
    this.cursor.rotation.z=angle;
    this.cursor.position.z=this.view==='ring'?.05:-(cycle-this.#start)*this.#spacing;
    this.controls.update();
    this.renderer.render(this.scene,this.camera);
    for(const tag of this.#tags) {
      const p=tag.point.clone().project(this.camera);
      tag.element.style.transform=`translate(${(p.x+1)*this.#width/2}px,${(-p.y+1)*this.#height/2}px)`;
      tag.element.hidden=p.z>1||p.z< -1||Math.abs(p.x)>1||Math.abs(p.y)>1;
    }
  }
  cameraState(){return {position:this.camera.position.toArray(),target:this.controls.target.toArray()};}
}
