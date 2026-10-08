"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MOUSE, TOUCH, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { clamp } from "../lib/math";
import { toolState } from "../lib/tools";
import { idleSeconds, on, world } from "../lib/world";

const HOME_TARGET = new Vector3(-0.4, 2.0, 0);
const HOME_POS = new Vector3(18.2, 7.6, 22.4);
const INTRO_FROM = new Vector3(30, 22, 44);

const tmp = new Vector3();
const dir = new Vector3();

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const state = useRef({
    intro: 0,
    introDone: false,
    focusTarget: null as Vector3 | null,
    focusDist: 0,
  });

  const portrait = size.width < size.height;
  const homePos = HOME_POS.clone().multiplyScalar(portrait ? 1.45 : 1);

  useEffect(() => {
    camera.position.copy(INTRO_FROM);
    camera.lookAt(HOME_TARGET);
    const off1 = on("focus", ({ pos }) => {
      const s = state.current;
      s.introDone = true;
      if (pos) {
        s.focusTarget = pos.clone().setY(Math.max(pos.y, 0.3) + 0.3);
        s.focusDist = world.mobile ? 13 : 11;
      } else {
        s.focusTarget = HOME_TARGET.clone();
        s.focusDist = homePos.distanceTo(HOME_TARGET);
      }
    });
    const off2 = on("reset", () => {
      const s = state.current;
      s.introDone = true;
      s.focusTarget = HOME_TARGET.clone();
      s.focusDist = homePos.distanceTo(HOME_TARGET);
    });
    return () => {
      off1();
      off2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const s = state.current;

    if (!s.introDone) {
      s.intro += dt / 4.2;
      const t = clamp(s.intro);
      const e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(INTRO_FROM, homePos, e);
      c.target.copy(HOME_TARGET);
      if (t >= 1) s.introDone = true;
    }

    if (s.focusTarget) {
      const k = 1 - Math.exp(-dt * 3);
      tmp.copy(c.target);
      c.target.lerp(s.focusTarget, k);
      camera.position.add(tmp.subVectors(c.target, tmp));
      dir.subVectors(camera.position, c.target);
      const d = dir.length();
      const nd = d + (s.focusDist - d) * k;
      camera.position.copy(c.target).addScaledVector(dir.normalize(), nd);
      if (c.target.distanceTo(s.focusTarget) < 0.02 && Math.abs(nd - s.focusDist) < 0.05) s.focusTarget = null;
    }

    // keep target inside the island
    if (c.target.length() > 14) c.target.setLength(14);

    const idle = idleSeconds();
    c.autoRotate = s.introDone && idle > 18 && !world.holding && !world.draggingTime;
    c.autoRotateSpeed = 0.22 * clamp((idle - 18) / 6);
    c.enabled = !world.holding && !world.draggingTime;
    // with a tool in hand, the left button / one finger belongs to the tool
    const hand = toolState.tool === "hand";
    c.mouseButtons.LEFT = hand ? MOUSE.ROTATE : (-1 as MOUSE);
    c.touches.ONE = hand ? TOUCH.ROTATE : (-1 as TOUCH);
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.06}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      enablePan={false}
      minDistance={6}
      maxDistance={58}
      minPolarAngle={0.25}
      maxPolarAngle={1.42}
      target={HOME_TARGET}
      onStart={() => {
        state.current.introDone = true;
        state.current.focusTarget = null;
      }}
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE }}
    />
  );
}
