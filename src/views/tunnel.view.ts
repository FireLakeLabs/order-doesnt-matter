import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import { createScoreMesh } from './shared/score-mesh';
import type { ScoreMesh } from './shared/score-mesh';
import { cycleStrips, scoreInventory } from './shared/score-strips';
import { nextSection, tunnelCycles, tunnelPose } from './tunnel/model';

const view: ViewDefinition = {
  id: 'tunnel',
  name: 'Fly-through',
  tag: "what's coming",
  async mount(element) {
    const stage = await createThreeStage(element, 'tunnel');
    const { THREE, scene, camera, root } = stage;
    const rings = new Map<number, ScoreMesh>();
    const gateMaterial = new THREE.MeshBasicMaterial();
    const gateGeometry = new THREE.BoxGeometry(0.006, 0.73, 0.01);
    const gate = new THREE.Mesh(gateGeometry, gateMaterial);
    const beadGeometry = new THREE.SphereGeometry(0.013, 12, 8);
    const bead = new THREE.Mesh(beadGeometry, gateMaterial);
    scene.add(gate, bead);
    const caption = document.createElement('div');
    caption.style.cssText =
      'position:absolute;left:24px;bottom:24px;padding:12px 16px;pointer-events:none;line-height:1.6';
    root.append(caption);
    let notes: ViewFrame['notes'] | undefined,
      inventory = '',
      theme: ViewFrame['theme'] | undefined;
    let last: ViewFrame | undefined;
    return {
      frame(frame) {
        const key = scoreInventory(frame);
        if (
          last?.now === frame.now &&
          last.notes === frame.notes &&
          last.theme === frame.theme &&
          key === inventory &&
          last.width === frame.width &&
          last.height === frame.height &&
          last.dpr === frame.dpr &&
          last.lookAhead === frame.lookAhead &&
          last.trails === frame.trails &&
          last.cps === frame.cps
        )
          return;
        last = { ...frame };
        stage.resize(frame);
        const cycles = tunnelCycles(frame.now, frame.lookAhead);
        const changed = notes !== frame.notes || inventory !== key || theme !== frame.theme;
        for (const [cycle, ring] of rings)
          if (!cycles.includes(cycle)) {
            ring.dispose();
            rings.delete(cycle);
          }
        const distance =
          (1 / (0.88 * Math.tan((48 * Math.PI) / 360))) * Math.max(1, frame.height / frame.width);
        camera.position.set(0, 0, distance);
        camera.lookAt(0, 0, 0);
        for (const cycle of cycles) {
          let ring = rings.get(cycle);
          const fresh = !ring;
          if (!ring) {
            ring = createScoreMesh(stage);
            rings.set(cycle, ring);
            scene.add(ring.mesh);
          }
          if (changed || fresh) ring.populate(cycleStrips(frame, cycle));
          const pose = tunnelPose(cycle, frame.now, frame.lookAhead);
          // The camera advances exponentially through fixed successive depth planes.
          // Moving the world relative to the camera is the same continuous travel.
          const z = distance * (1 - pose.depth);
          const offset =
            Math.max(0, pose.depth - 1.2) *
            distance *
            Math.tan((48 * Math.PI) / 360) *
            (frame.width / frame.height) *
            0.12;
          ring.mesh.position.set(
            offset * (0.85 + Math.sin(frame.now / 32) * 0.15),
            Math.sin(frame.now / 41) * offset * 0.12,
            z,
          );
          ring.mesh.visible = pose.brightness > 0;
          ring.update(frame, pose.passed ? 1 : pose.brightness, pose.passed ? pose.brightness : 1);
        }
        const currentDepth = tunnelPose(Math.floor(frame.now), frame.now, frame.lookAhead).depth;
        gate.position.set(0, 0.64, distance * (1 - currentDepth) + 0.025);
        bead.position.set(0, 1.015, gate.position.z);
        gateMaterial.color.set(frame.theme.text);
        const next = nextSection(frame);
        caption.textContent = next
          ? `${next.name} in ${String(next.cycles)} cycles`
          : `cycle ${String(Math.floor(frame.now) + 1)} · ${String(frame.lookAhead)} cycles ahead`;
        if (frame.to < Math.floor(frame.now) + frame.lookAhead + 1)
          caption.textContent += ' · asking score ahead…';
        caption.style.color = frame.theme.text;
        caption.style.background = frame.theme.panel;
        caption.style.border = `1px solid ${frame.theme.line}`;
        caption.style.borderRadius = `${String(frame.theme.radius)}px`;
        caption.style.font = `14px "${frame.theme.fontMono}"`;
        stage.render(frame, (enabled) => {
          gate.visible = bead.visible = !enabled;
          for (const ring of rings.values()) ring.emission(enabled);
        });
        notes = frame.notes;
        inventory = key;
        theme = frame.theme;
      },
      dispose() {
        for (const ring of rings.values()) ring.dispose();
        gateGeometry.dispose();
        beadGeometry.dispose();
        gateMaterial.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
