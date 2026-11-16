import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import { createScoreMesh } from './shared/score-mesh';
import { cycleStrips, scoreInventory } from './shared/score-strips';
import { coilDetail, coilRange, helixPoint, coilPose } from './coil/model';
import type { ScoreStrip } from './shared/score-mesh';

const view: ViewDefinition = {
  id: 'coil',
  name: 'Coil',
  tag: 'whole song',
  span: 'song',
  async mount(element) {
    const stage = await createThreeStage(element, 'coil');
    const { THREE, scene, camera, root, canvas } = stage;
    camera.fov = 1;
    camera.up.set(0, 1, -0.25);
    const body = new THREE.Group();
    scene.add(body);
    const score = createScoreMesh(stage, true);
    const detail = createScoreMesh(stage, true);
    body.add(score.mesh, detail.mesh);
    const gateMaterial = new THREE.MeshBasicMaterial();
    const gateGeometry = new THREE.SphereGeometry(0.026, 12, 8);
    const bead = new THREE.Mesh(gateGeometry, gateMaterial);
    body.add(bead);
    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial();
    const gate = new THREE.Line(lineGeometry, lineMaterial);
    body.add(gate);
    const labels = document.createElement('div');
    labels.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    root.append(labels);
    const caption = document.createElement('div');
    caption.style.cssText = 'position:absolute;left:5%;bottom:24px;pointer-events:none';
    root.append(caption);
    let notes: ViewFrame['notes'] | undefined,
      inventory = '',
      topology = '',
      theme: ViewFrame['theme'] | undefined;
    let rangeKey = '',
      detailCycle = NaN;
    let brackets: { element: HTMLDivElement; from: number; to: number; name: string }[] = [];
    let drag: { id: number; y: number; rotation: number } | undefined;
    let rotation = 0;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, y: event.clientY, rotation };
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (drag?.id === event.pointerId) rotation = drag.rotation + (event.clientY - drag.y) * 0.008;
    };
    const up = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      drag = undefined;
    };
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    let last: ViewFrame | undefined;
    const point = new THREE.Vector3();
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const key = scoreInventory(frame);
        if (
          last?.now === frame.now &&
          last.notes === frame.notes &&
          last.theme === frame.theme &&
          key === inventory &&
          last.width === frame.width &&
          last.height === frame.height &&
          last.dpr === frame.dpr &&
          last.trails === frame.trails &&
          last.cps === frame.cps &&
          Math.abs(rotation - body.rotation.x) < 0.0001 &&
          (drag || rotation === 0)
        )
          return;
        last = { ...frame };
        const resized = stage.resize(frame);
        const range = coilRange(frame);
        const sectionsKey = frame.sections
          .map((s) => `${s.name}:${String(s.from)}:${String(s.to)}`)
          .join('|');
        const nextRangeKey = `${String(range.from)}:${String(range.length)}:${sectionsKey}`;
        const cycle = Math.floor(frame.now);
        const shape = frame.instruments.map((i) => `${i.id}:${String(i.index)}`).join('|');
        const changed = notes !== frame.notes || topology !== shape || rangeKey !== nextRangeKey;
        const styled = resized || theme !== frame.theme || inventory !== key;
        const compressed = range.length > 64;
        if (changed || styled) {
          // A continuous outer spine joins the loops even where section membership
          // changes the instrument bands within them.
          const strips: ScoreStrip[] = [
            {
              cycle: range.from,
              radius: 1.025,
              width: 0.004,
              colour: frame.theme.muted,
              muted: false,
              track: true,
              segments: range.length > 64 ? 24 : 128,
              arcs: [{ from: 0, to: range.length, start: 0, end: 0, onset: false }],
            },
          ];
          for (let cycle = range.from; cycle < range.to; cycle++)
            strips.push(...cycleStrips(frame, cycle, compressed));
          if (changed || !score.restyle(strips)) score.populate(strips);
          score.material.uniforms.songFrom.value = range.from;
          score.material.uniforms.songLength.value = range.length;
          score.material.uniforms.hideNear.value = compressed ? 1 : 0;
        }
        detail.mesh.visible = compressed;
        if (compressed && (changed || styled || detailCycle !== cycle)) {
          // Only seven nearby loops change detail at a seam; the whole-song
          // occupancy and connecting spine retain their original GPU buffers.
          const strips: ScoreStrip[] = [];
          for (
            let turn = Math.max(range.from, cycle - 3);
            turn < Math.min(range.to, cycle + 4);
            turn++
          )
            if (coilDetail(turn, frame.now, range.length))
              strips.push(...cycleStrips(frame, turn).filter((strip) => !strip.track));
          if (changed || detailCycle !== cycle || !detail.restyle(strips)) detail.populate(strips);
          detail.material.uniforms.songFrom.value = range.from;
          detail.material.uniforms.songLength.value = range.length;
          detailCycle = cycle;
        }
        notes = frame.notes;
        inventory = key;
        topology = shape;
        theme = frame.theme;
        if (rangeKey !== nextRangeKey) {
          labels.replaceChildren();
          brackets = [];
          for (const section of frame.sections) {
            const element = document.createElement('div');
            element.style.cssText =
              'position:absolute;height:12px;border:1px solid;border-top:0;white-space:nowrap;padding-top:18px;font-size:12px';
            element.className = 'coil-section';
            element.textContent = section.name;
            labels.append(element);
            brackets.push({
              element,
              from: section.from + range.from,
              to: section.to + range.from,
              name: section.name,
            });
          }
          rangeKey = nextRangeKey;
        }
        // Cosmetic release is deliberately frame-based; it never moves score time.
        if (!drag) rotation = Math.abs(rotation) < 0.001 ? 0 : rotation * 0.82;
        body.rotation.x = rotation;
        const { distance, follow } = coilPose(frame, range.from, range.length);
        camera.position.set(distance * 0.18 + follow, distance * 0.25, distance);
        camera.lookAt(follow, 0, 0);
        // Tight depth bounds preserve precision with the distant, narrow-angle lens.
        camera.near = distance * 0.5;
        camera.far = distance * 1.5;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        body.updateMatrixWorld();
        score.update(frame);
        detail.update(frame);
        const at = helixPoint(frame.now, range.from, range.length, 1.18);
        bead.position.set(at.x, at.y, at.z);
        const inner = helixPoint(frame.now, range.from, range.length, 0.25);
        const positions = new Float32Array([inner.x, inner.y, inner.z, at.x, at.y, at.z]);
        if (!Object.hasOwn(lineGeometry.attributes, 'position'))
          lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        else {
          const attribute = lineGeometry.getAttribute('position');
          (attribute.array as Float32Array).set(positions);
          attribute.needsUpdate = true;
        }
        gate.frustumCulled = false;
        bead.frustumCulled = false;
        gateMaterial.color.set(frame.theme.text);
        lineMaterial.color.set(frame.theme.text);
        point.set(0, -1.5, 0).project(camera);
        const baseline = ((1 - point.y) * frame.height) / 2;
        for (const bracket of brackets) {
          point
            .set(((bracket.from - range.from) / range.length - 0.5) * 10, -1.5, 0)
            .project(camera);
          const x = ((point.x + 1) * frame.width) / 2;
          point.set(((bracket.to - range.from) / range.length - 0.5) * 10, -1.5, 0).project(camera);
          const right = ((point.x + 1) * frame.width) / 2;
          const active = frame.now >= bracket.from && frame.now < bracket.to;
          bracket.element.style.left = `${String(x)}px`;
          bracket.element.style.top = `${String(baseline)}px`;
          bracket.element.style.width = `${String(Math.max(1, right - x - 4))}px`;
          bracket.element.style.color = active ? frame.theme.text : frame.theme.muted;
          bracket.element.style.borderColor = active ? frame.theme.accent : frame.theme.line;
          bracket.element.style.fontFamily = `"${frame.theme.fontMono}"`;
        }
        caption.textContent = range.open
          ? '16 cycles shown'
          : `cycle ${String(cycle - range.from + 1)} / ${String(range.length)} · drag to turn`;
        caption.style.color = frame.theme.muted;
        caption.style.font = `13px "${frame.theme.fontMono}"`;
        stage.render(frame, (enabled) => {
          gate.visible = bead.visible = !enabled;
          score.emission(enabled);
          detail.emission(enabled);
        });
      },
      dispose() {
        if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up);
        score.dispose();
        detail.dispose();
        gateGeometry.dispose();
        gateMaterial.dispose();
        lineGeometry.dispose();
        lineMaterial.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
