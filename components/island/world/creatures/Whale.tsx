"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Color, Group, MeshStandardMaterial, SphereGeometry, Vector3 } from "three";
import { merge, place, prep } from "../../lib/geo";
import { discover } from "../../lib/secrets";
import { addRipple, on, sfx, world } from "../../lib/world";
import { spawnSparkle, spawnSplash } from "../effects/Particles";

function whaleBody() {
  const top = new Color("#3e5566");
  const belly = new Color("#c9d3d6");
  const b = new SphereGeometry(1, 20, 14);
  place(b, [0, 0, 0], [0, 0, 0], [0.85, 0.7, 2.6]);
  const head = new SphereGeometry(0.75, 16, 12);
  place(head, [0, 0.05, 1.6], [0, 0, 0], [1, 0.85, 1.2]);
  const finL = new SphereGeometry(0.5, 8, 6);
  place(finL, [0.85, -0.35, 0.9], [0.2, 0.4, -0.5], [1.2, 0.08, 0.4]);
  const finR = new SphereGeometry(0.5, 8, 6);
  place(finR, [-0.85, -0.35, 0.9], [0.2, -0.4, 0.5], [1.2, 0.08, 0.4]);
  const dorsal = new SphereGeometry(0.3, 8, 6);
  place(dorsal, [0, 0.62, -0.9], [0.5, 0, 0], [0.18, 0.7, 0.7]);
  const tone = (p: Vector3) => (p.y < -0.2 ? belly : top);
  return merge([prep(b, tone), prep(head, tone), prep(finL, top), prep(finR, top), prep(dorsal, top)]) as BufferGeometry;
}

function fluke() {
  const top = new Color("#3e5566");
  const stock = new SphereGeometry(0.4, 10, 8);
  place(stock, [0, 0, -0.6], [0, 0, 0], [0.7, 0.55, 1.6]);
  const l = new SphereGeometry(0.6, 10, 6);
  place(l, [0.6, 0, -1.3], [0, -0.5, 0], [1.3, 0.1, 0.5]);
  const r = new SphereGeometry(0.6, 10, 6);
  place(r, [-0.6, 0, -1.3], [0, 0.5, 0], [1.3, 0.1, 0.5]);
  return merge([prep(stock, top), prep(l, top), prep(r, top)]) as BufferGeometry;
}

const DUR = 7.5;

export function Whale() {
  const { camera } = useThree();
  const root = useRef<Group>(null);
  const tail = useRef<Group>(null);
  const body = useMemo(() => whaleBody(), []);
  const tailGeo = useMemo(() => fluke(), []);
  const mat = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 }), []);
  const s = useRef({ t: -1, start: new Vector3(), dir: new Vector3(), spout: false, dive: false, rippleT: 0 });

  useEffect(
    () =>
      on("whale", () => {
        const st = s.current;
        if (st.t >= 0) return;
        // offshore, off to one side of the view so the island doesn't hide it
        const toCenter = new Vector3(-camera.position.x, 0, -camera.position.z).normalize();
        const side = Math.random() < 0.5 ? 1 : -1;
        const a = Math.atan2(toCenter.z, toCenter.x) + side * 0.9;
        st.start.set(Math.cos(a) * 21, 0, Math.sin(a) * 21);
        st.dir.set(-Math.sin(a) * side, 0, Math.cos(a) * side);
        st.t = 0;
        st.spout = false;
        st.dive = false;
        addRipple(st.start.x, st.start.z, 1);
      }),
    [camera],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const st = s.current;
    const o = root.current;
    if (!o) return;
    if (st.t < 0) {
      o.visible = false;
      return;
    }
    st.t += dt;
    o.visible = true;
    const u = Math.min(1, Math.max(0, (st.t - 0.6) / 5.2));
    const p = st.start.clone().addScaledVector(st.dir, u * 7);
    const y = -1.6 + Math.sin(u * Math.PI) * 1.75;
    o.position.set(p.x, y, p.z);
    o.rotation.set(-Math.cos(u * Math.PI) * 0.45, Math.atan2(st.dir.x, st.dir.z), 0, "YXZ");
    if (tail.current) tail.current.rotation.x = u > 0.65 ? -Math.sin(((u - 0.65) / 0.35) * Math.PI) * 0.9 : 0;

    st.rippleT -= dt;
    if (st.rippleT < 0 && y > -1.2) {
      st.rippleT = 0.25;
      addRipple(p.x, p.z, 0.5);
      if (world.night > 0.5) spawnSparkle(new Vector3(p.x, 0.1, p.z), 6, new Color("#7ff3e0"), 1.2, 0.4);
    }
    if (!st.spout && st.t > 1.6) {
      st.spout = true;
      discover("whale");
      sfx("whale", p, 1, 1);
      const head = p.clone().addScaledVector(st.dir, 1.4);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => spawnSplash(new Vector3(head.x, 0.6 + i * 0.3, head.z), 0.9), i * 90);
      }
    }
    if (!st.dive && u > 0.92) {
      st.dive = true;
      const back = p.clone().addScaledVector(st.dir, -3);
      spawnSplash(new Vector3(back.x, 0.05, back.z), 1);
      addRipple(back.x, back.z, 1);
      sfx("splash", back, 1, 0.6);
    }
    if (st.t > DUR) st.t = -1;
  });

  return (
    <group ref={root} visible={false} scale={1.1}>
      <mesh geometry={body} material={mat} />
      <group ref={tail} position={[0, 0, -2.3]}>
        <mesh geometry={tailGeo} material={mat} />
      </group>
    </group>
  );
}
