import type { ViewFrame } from '../types';
import type { ThreeStage } from './three-stage';
import { scoreGeometry, lightRange } from './score-geometry';
import type { ScoreStrip, LightRange } from './score-geometry';
export type { ScoreStrip } from './score-geometry';

/** One draw call for a collection of bands, including a whole song's helix. */
export function createScoreMesh(stage: Pick<ThreeStage, 'THREE' | 'quality'>, helix = false) {
  const { THREE } = stage;
  const ground = new THREE.Color(),
    highlight = new THREE.Color();
  const material = new THREE.ShaderMaterial({
    defines: { HELIX: helix ? 1 : 0 },
    uniforms: {
      now: { value: 0 },
      ground: { value: ground },
      highlight: { value: highlight },
      flashDuration: { value: 0.075 },
      trail: { value: 0.25 },
      lightPass: { value: 0 },
      fade: { value: 1 },
      opacity: { value: 1 },
      hideNear: { value: 0 },
      helix: { value: helix ? 1 : 0 },
      songFrom: { value: 0 },
      songLength: { value: 16 },
    },
    vertexShader: `
      attribute vec3 timing; attribute vec3 band; attribute vec3 ink; attribute float quiet;
      #if HELIX
      attribute vec3 curve;
      #endif
      uniform float now; uniform float helix; uniform float songFrom; uniform float songLength;
      varying vec3 vTiming; varying vec3 vInk; varying vec3 vSurface;
      void main(){
        float time=position.x;
        vec3 point;
        float side = 1.;
        #if HELIX
          float d = (time-now)/0.7;
          float playing = abs(d)<2. ? exp(-d*d*d*d) : 0.;
          float enlarge = 1.+playing*0.16;
          point=vec3(((time-songFrom)/songLength-0.5)*10.,curve.y*enlarge,curve.x*enlarge+position.z);
          side=mix(0.34,1.,(curve.z+1.)*0.5);
        #else
          float angle=(time-now)*6.28318530718;
          float r=band.x+position.y*band.y;
          point=vec3(sin(angle)*r,cos(angle)*r,position.z);
        #endif
        vTiming=timing; vInk=ink;
        vSurface=vec3(time,band.z*quiet,side);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);
      }`,
    fragmentShader: `
      uniform float now; uniform float flashDuration; uniform float trail; uniform float lightPass;
      uniform float fade; uniform float opacity; uniform float hideNear; uniform float helix; uniform vec3 ground; uniform vec3 highlight;
      varying vec3 vTiming; varying vec3 vInk; varying vec3 vSurface;
      void main(){
        bool track=vTiming.z<0.;
        if (!track && hideNear>0.5 && abs(floor(vSurface.x)-floor(now))<3.5) discard;
        float sounding=track?0.:step(vTiming.x,now)*(1.-step(vTiming.y,now));
        float flash=max(0.,vTiming.z)*step(vTiming.x,now)*max(0.,1.-(now-vTiming.x)/flashDuration);
        flash*=flash*(1.-smoothstep(0.025,0.055,vSurface.x-vTiming.x));
        float age=now-vSurface.x;
        float brightness=age<=0.?1.:(trail>0.?mix(0.3,1.,max(0.,1.-age/trail)):0.3);
        if(helix>0.5) brightness=max(brightness,0.8);
        brightness=track?0.19:max(brightness,sounding);
        float strength=fade*vSurface.y*vSurface.z;
        if(lightPass>0.5){
          if(sounding+flash<0.001) discard;
          gl_FragColor=vec4(vInk*max(sounding,flash)*strength,opacity);
        }else{
          vec3 colour=mix(ground,vInk,brightness*strength);
          colour=mix(colour,highlight,flash*0.85*strength);
          gl_FragColor=vec4(colour,opacity);
        }
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  const colour = new THREE.Color();
  let lods: { geometry: typeof mesh.geometry; lights: LightRange[] }[] = [],
    emitting = { start: 0, count: 0 };
  return {
    mesh,
    material,
    populate(strips: ScoreStrip[]) {
      const data = scoreGeometry(
        strips,
        (ink) => {
          colour.set(ink);
          return [colour.r, colour.g, colour.b];
        },
        helix,
      );
      if (lods.length) for (const lod of lods) lod.geometry.dispose();
      else mesh.geometry.dispose();
      const attributes = {
        position: new THREE.BufferAttribute(data.positions, 3),
        timing: new THREE.BufferAttribute(data.timing, 3),
        band: new THREE.BufferAttribute(data.bands, 3),
        ink: new THREE.BufferAttribute(data.inks, 3),
        quiet: new THREE.BufferAttribute(data.quiet, 1),
      };
      const curve = new THREE.BufferAttribute(data.curves, 3);
      // Static index LODs share the same vertex buffers and keep every arc's
      // exact endpoints. Only curve tessellation follows render resolution.
      lods = data.lods.map((lod) => {
        const geometry = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(attributes))
          geometry.setAttribute(name, attribute);
        if (helix) geometry.setAttribute('curve', curve);
        geometry.setIndex(new THREE.BufferAttribute(lod.indices, 1));
        return { geometry, lights: lod.lights };
      });
      mesh.geometry = lods[0].geometry;
    },
    update(frame: ViewFrame, fade = 1, opacity = 1) {
      const u = material.uniforms;
      u.now.value = frame.now;
      ground.set(frame.theme.ground);
      highlight.set(frame.theme.text);
      u.flashDuration.value = Math.max(0.00001, frame.cps * 0.15);
      u.trail.value = frame.trails === 1 ? 0.25 : frame.trails === 2 ? 1 : 0;
      u.fade.value = fade;
      u.opacity.value = opacity;
      if (lods.length) {
        const lod = lods[stage.quality.scale >= 0.75 ? 0 : stage.quality.scale >= 0.5 ? 1 : 2];
        mesh.geometry = lod.geometry;
        if (frame.theme.glow && stage.quality.bloom)
          emitting = lightRange(lod.lights, frame.now, Math.max(0.00001, frame.cps * 0.15));
      }
    },
    emission(enabled: boolean) {
      material.uniforms.lightPass.value = enabled ? 1 : 0;
      mesh.geometry.setDrawRange(enabled ? emitting.start : 0, enabled ? emitting.count : Infinity);
    },
    dispose() {
      if (lods.length) for (const lod of lods) lod.geometry.dispose();
      else mesh.geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
export type ScoreMesh = ReturnType<typeof createScoreMesh>;
