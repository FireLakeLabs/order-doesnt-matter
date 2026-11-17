import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import {
  cameraPose,
  gateX,
  indexRibbons,
  ribbonAt,
  ribbonGeometry,
  ribbonParts,
  timeScale,
} from './ribbons/model';

const vertexShader = `
attribute vec3 edge, mark, ink;
uniform float now, reach, height, distanceToCamera, origin, renderRatio;
uniform vec2 resolution;
varying vec3 vInk,vMark;
varying float vPhase,vSide,vTurn,vTime;
void main(){
  float phase=(position.x-now)/reach;
  float side=edge.x;
  float width=max(1.8,height/673.*1.8)+edge.y;
  if(mark.x<.5)width=0.;
  float y=position.y*height+sin((position.x+origin)*.9+mark.y*.83)*height*.008;
  float z=position.z*height-max(0.,phase)*height*.55;
  y+=side*width*.5*cos(edge.z);
  z+=side*width*.5*sin(edge.z)+sin((position.x+origin)*.7+mark.y)*8.;
  z+=mark.x>.5?.3:-2.5;
  float x=(${String(gateX)}.+phase*${String(timeScale)}.)*(1.-z/distanceToCamera);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(x,y,z,1.);
  // A rest stays a continuous thread even when the shared stage reduces its
  // backing resolution. Note widths still come from their scored gain.
  float threadPixels=max(2.2,max(1.8,1.8*resolution.x/960.)*renderRatio);
  if(mark.x<.5)gl_Position.y+=side*threadPixels/resolution.y/renderRatio*gl_Position.w;
  vInk=ink;vMark=mark;vPhase=phase;vSide=side;vTurn=edge.z;vTime=position.x+origin;
}`;
const fragmentShader = `
uniform vec3 ground,highlight;
uniform float lightPass,paper,pocket;
varying vec3 vInk,vMark;
varying float vPhase,vSide,vTurn,vTime;
void main(){
  float ends=smoothstep(-.51,-.43,vPhase)*(1.-smoothstep(.59,.66,vPhase));
  if(ends<.002)discard;
  float fade=ends*(vPhase<0.?exp(vPhase*2.7):1./(1.+vPhase*1.8));
  if(paper>.5)fade=max(.68,fade)*ends;
  float gate=exp(-pow(vPhase*75.,2.));
  float silk=.68+.32*cos(vSide*2.1+vTurn*.6);
  float crease=pow(max(0.,1.-abs(vSide-.28)),18.);
  vec3 colour=mix(ground,vInk,fade*silk*vMark.z);
  if(vMark.x>.5)colour=mix(colour,highlight,crease*fade*.16+gate*.7*vMark.z);
  if(pocket>.5 && mod(vMark.y,3.)>.5){
    float stripe=step(.55,fract(vTime*32.+vMark.y*.37));
    colour=mix(colour,ground,stripe*.32*step(.3,abs(vSide)));
  }
  if(lightPass>.5)colour=vInk*gate*ends*vMark.x*vMark.z*.85;
  gl_FragColor=vec4(colour,1.);
  #include <colorspace_fragment>
}`;

const view: ViewDefinition = {
  id: 'ribbons',
  group: 'show',
  name: 'Ribbons',
  tag: 'silk & light',
  async mount(element) {
    const THREE = await import('three');
    const stage = await createThreeStage(element, 'ribbons');
    const uniforms = {
      now: { value: 0 },
      reach: { value: 1 },
      height: { value: 600 },
      distanceToCamera: { value: 700 },
      origin: { value: 0 },
      renderRatio: { value: 1 },
      resolution: { value: new THREE.Vector2(1, 1) },
      ground: { value: new THREE.Color() },
      highlight: { value: new THREE.Color() },
      lightPass: { value: 0 },
      paper: { value: 0 },
      pocket: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.frustumCulled = false;
    stage.scene.add(mesh);
    const curtainMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        uniform float height,distanceToCamera;varying float vEdge;
        void main(){
          float z=position.z*height;
          float x=(${String(gateX)}.+position.x)*(1.-z/distanceToCamera);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(x,position.y*height,z,1.);
          vEdge=position.x;
        }`,
      fragmentShader: `
        uniform vec3 ground,highlight;uniform float lightPass;varying float vEdge;
        void main(){
          float core=1.-smoothstep(1.,2.5,abs(vEdge));
          vec3 colour=mix(ground,highlight,.035+core*.9);
          if(lightPass>.5)colour=highlight*core*.65;
          gl_FragColor=vec4(colour,1.);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const curtainGeometry = new THREE.BufferGeometry();
    curtainGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -3, -0.45, 0.24, 3, -0.45, 0.24, 3, 0.45, 0.24, -3, -0.45, 0.24, 3, 0.45, 0.24, -3, 0.45,
          0.24, 3, -0.45, 0.24, 38, -0.43, -0.1, 38, 0.43, -0.1, 3, -0.45, 0.24, 38, 0.43, -0.1, 3,
          0.45, 0.24,
        ],
        3,
      ),
    );
    const curtain = new THREE.Mesh(curtainGeometry, curtainMaterial);
    curtain.frustumCulled = false;
    curtain.renderOrder = -1;
    stage.scene.add(curtain);
    function label(css: string) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;pointer-events:none;${css}`;
      stage.root.append(el);
      return el;
    }
    const caption = label(
      'left:24px;top:18px;max-width:85%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis',
    );
    const played = label('left:18px;bottom:16px');
    played.textContent = '← played';
    const coming = label('right:18px;bottom:16px');
    coming.textContent = 'coming →';
    const gate = label('left:43.75%;bottom:16px;transform:translateX(-50%)');
    gate.textContent = 'now';
    const names = new Map<string, HTMLDivElement>();
    let source: ViewFrame['notes'] | undefined;
    let score = indexRibbons([]);
    let inventory = '';
    let parts: ReturnType<typeof ribbonParts> = [];
    let previous: ViewFrame | undefined;
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        if (source !== frame.notes) {
          score = indexRibbons(frame.notes);
          source = frame.notes;
        }
        const nextParts = ribbonParts(frame, score);
        const key =
          nextParts
            .map(
              (p) =>
                `${p.instrument.id}:${p.instrument.name}:${String(p.instrument.index)}:${p.instrument.colour}:${String(p.instrument.muted)}:${String(p.baseline)}:${String(p.depth)}:${JSON.stringify(p.instrument.settings)}`,
            )
            .join('|') +
          `:${String(frame.from)}:${String(frame.to)}:${JSON.stringify(frame.sections)}`;
        if (
          previous?.now === frame.now &&
          previous.notes === frame.notes &&
          previous.theme === frame.theme &&
          previous.width === frame.width &&
          previous.height === frame.height &&
          previous.dpr === frame.dpr &&
          previous.lookAhead === frame.lookAhead &&
          previous.playing === frame.playing &&
          key === inventory
        )
          return;
        stage.resize(frame);
        if (previous?.notes !== frame.notes || key !== inventory) {
          parts = nextParts;
          const data = ribbonGeometry(frame, parts);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
          geometry.setAttribute('edge', new THREE.BufferAttribute(data.edges, 3));
          geometry.setAttribute('mark', new THREE.BufferAttribute(data.marks, 3));
          geometry.setIndex(data.indices);
          const colours = new Float32Array(data.positions.length);
          const inks = new Map(
            parts.map((p) => [p.instrument.index, new THREE.Color(p.instrument.colour)]),
          );
          for (let i = 0; i < colours.length / 3; i++) {
            const colour = inks.get(data.marks[i * 3 + 1]);
            if (colour) {
              colours[i * 3] = colour.r;
              colours[i * 3 + 1] = colour.g;
              colours[i * 3 + 2] = colour.b;
            }
          }
          geometry.setAttribute('ink', new THREE.BufferAttribute(colours, 3));
          mesh.geometry.dispose();
          mesh.geometry = geometry;
          for (const el of names.values()) el.remove();
          names.clear();
          for (const part of parts)
            names.set(
              part.instrument.id,
              label(
                'left:18px;max-width:24%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
              ),
            );
          stage.canvas.dataset.spans = String(data.spans);
          stage.canvas.dataset.vertices = String(data.positions.length / 3);
          stage.canvas.dataset.triangles = String(data.indices.length / 3);
          stage.canvas.dataset.threads = String(data.threads);
        }
        inventory = key;
        previous = { ...frame };
        const height = (960 * frame.height) / frame.width;
        const distance = height / (2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2)));
        const pose = cameraPose(frame.now);
        stage.camera.position.set(pose.x * height, pose.y * height, distance);
        stage.camera.lookAt(0, 0, 0);
        stage.camera.updateMatrixWorld();
        uniforms.now.value = frame.now - frame.from;
        uniforms.origin.value = frame.from;
        uniforms.reach.value = Math.max(0.001, frame.lookAhead);
        uniforms.height.value = height;
        uniforms.renderRatio.value = Math.max(0.1, frame.dpr * stage.quality.scale);
        uniforms.resolution.value.set(frame.width, frame.height);
        uniforms.distanceToCamera.value = distance;
        uniforms.ground.value.set(frame.theme.ground);
        uniforms.highlight.value.set(frame.theme.text);
        uniforms.paper.value = frame.theme.glow ? 0 : 1;
        uniforms.pocket.value = frame.theme.name === 'pocket' ? 1 : 0;
        const labels = parts
          .map((part) => ({ part, y: (0.5 - ribbonAt(part, frame.now).height) * frame.height }))
          .sort((a, b) => a.y - b.y);
        let lastY = 60;
        for (const [i, item] of labels.entries()) {
          item.y = Math.max(
            lastY,
            Math.min(item.y, frame.height - 44 - (labels.length - 1 - i) * 16),
          );
          lastY = item.y + 16;
        }
        for (const { part, y } of labels) {
          const el = names.get(part.instrument.id);
          if (!el) continue;
          el.style.top = `${String(y - 10)}px`;
          el.style.font = `${String(Math.max(12, (11 * frame.width) / 960))}px "${frame.theme.fontMono}"`;
          el.style.color = part.instrument.colour;
          el.textContent = part.instrument.name;
        }
        const length = frame.sections.at(-1)?.to ?? 0;
        const cycle = length > 0 ? ((frame.now % length) + length) % length : frame.now;
        const section = frame.sections.find((s) => s.from <= cycle && cycle < s.to)?.name;
        caption.textContent = `${section ?? 'open score'} · bar ${String(Math.floor(frame.now) + 1)} · window ${String(frame.lookAhead)}`;
        caption.style.font = `${String(Math.max(13, (13 * frame.width) / 960))}px "${frame.theme.fontMono}"`;
        for (const el of [caption, played, coming, gate]) {
          el.style.color = el === gate ? frame.theme.text : frame.theme.muted;
          if (el !== caption)
            el.style.font = `${String(Math.max(12, (11 * frame.width) / 960))}px "${frame.theme.fontMono}"`;
        }
        stage.render(frame, (enabled) => {
          uniforms.lightPass.value = enabled ? 1 : 0;
        });
      },
      dispose() {
        mesh.geometry.dispose();
        material.dispose();
        curtainGeometry.dispose();
        curtainMaterial.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
