"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MOUSE, Raycaster, TOUCH, Vector2, Vector3, type Intersection } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { clamp, smoothstep } from "../lib/math";
import { height, inPond, POND_LEVEL } from "../lib/terrain";
import { groundTargets, toolState } from "../lib/tools";
import { idleSeconds, markInput, on, waveHeight, world } from "../lib/world";

const HOME_TARGET = new Vector3(0, 0.75, 0.8);
/** home view as azimuth / elevation / distance around HOME_TARGET */
const HOME = { az: 0.69, el: 0.34, dist: 26.5 };
const INTRO = { az: 1.45, el: 0.62, dist: 52 };
/** the look-at point may wander this far from the island centre */
const TARGET_RADIUS = 10.5;

const tmp = new Vector3();
const dir = new Vector3();
const ray = new Raycaster();
const ndc = new Vector2();
const hits: Intersection[] = [];

function orbitPos(out: Vector3, target: Vector3, az: number, el: number, dist: number) {
  return out.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
}

/** ground or water surface under a point */
function floorAt(x: number, z: number, t: number) {
  const h = height(x, z);
  if (inPond(x, z)) return Math.max(h, POND_LEVEL);
  return h < 0.05 ? Math.max(h, waveHeight(x, z, t, -h) + 0.05) : h;
}

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size, gl } = useThree();
  const state = useRef({
    intro: 0,
    introDone: false,
    focusTarget: null as Vector3 | null,
    focusDist: 0,
    userMoved: false,
  });

  const portrait = size.width < size.height;
  const homeDist = HOME.dist * (portrait ? 1.5 : 1);

  useEffect(() => {
    orbitPos(camera.position, HOME_TARGET, INTRO.az, INTRO.el, INTRO.dist);
    camera.lookAt(HOME_TARGET);
    const goHome = () => {
      const s = state.current;
      s.introDone = true;
      s.focusTarget = HOME_TARGET.clone();
      s.focusDist = homeDist;
    };
    const off1 = on("focus", ({ pos }) => {
      if (!pos) return goHome();
      const s = state.current;
      s.introDone = true;
      s.focusTarget = pos.clone().setY(Math.max(pos.y, 0.3) + 0.35);
      s.focusDist = world.mobile ? 12 : 10;
    });
    const off2 = on("reset", goHome);

    // double-click / double-tap glides the camera toward that spot
    const el = gl.domElement;
    const dbl = (e: MouseEvent) => {
      if (toolState.tool !== "hand" || world.holding) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      hits.length = 0;
      ray.intersectObjects(groundTargets, false, hits);
      const h = hits[0];
      if (!h) return;
      markInput();
      const s = state.current;
      s.introDone = true;
      const p = h.point.clone();
      if (Math.hypot(p.x, p.z) > TARGET_RADIUS) p.setLength(TARGET_RADIUS);
      s.focusTarget = p.setY(Math.max(floorAt(p.x, p.z, world.elapsed), 0) + 0.45);
      const cur = camera.position.distanceTo(controls.current?.target ?? HOME_TARGET);
      s.focusDist = clamp(cur * 0.6, 7, 14);
    };
    el.addEventListener("dblclick", dbl);
    return () => {
      off1();
      off2();
      el.removeEventListener("dblclick", dbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl]);

  useFrame((_, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 1 / 20);
    const s = state.current;

    // opening shot: a slow descending sweep around to the home view
    if (!s.introDone) {
      s.intro += dt / 5;
      const t = clamp(s.intro);
      const e = t * t * (3 - 2 * t);
      const az = INTRO.az + (HOME.az - INTRO.az) * e;
      const elv = INTRO.el + (HOME.el - INTRO.el) * e;
      const dist = INTRO.dist + (homeDist - INTRO.dist) * (1 - Math.pow(1 - t, 3));
      c.target.copy(HOME_TARGET);
      orbitPos(camera.position, HOME_TARGET, az, elv, dist);
      if (t >= 1) s.introDone = true;
    }

    if (s.focusTarget) {
      const k = 1 - Math.exp(-dt * 2.6);
      tmp.copy(c.target);
      c.target.lerp(s.focusTarget, k);
      camera.position.add(tmp.subVectors(c.target, tmp));
      dir.subVectors(camera.position, c.target);
      const d = dir.length();
      const nd = d + (s.focusDist - d) * k;
      camera.position.copy(c.target).addScaledVector(dir.normalize(), nd);
      if (c.target.distanceTo(s.focusTarget) < 0.02 && Math.abs(nd - s.focusDist) < 0.05) s.focusTarget = null;
    }

    const idle = idleSeconds();
    const dist = camera.position.distanceTo(c.target);

    if (s.introDone && !s.focusTarget) {
      // keep the look-at point over the island, and let it sink toward the ground when close
      const flat = Math.hypot(c.target.x, c.target.z);
      if (flat > TARGET_RADIUS) {
        const f = TARGET_RADIUS / flat;
        tmp.set(c.target.x * f - c.target.x, 0, c.target.z * f - c.target.z);
        c.target.add(tmp);
        camera.position.add(tmp);
      }
      const ground = Math.max(floorAt(c.target.x, c.target.z, world.elapsed), 0);
      const wantY = ground + 0.35 + (HOME_TARGET.y + 0.3 - ground - 0.35) * smoothstep(7, 30, dist);
      const dy = (wantY - c.target.y) * (1 - Math.exp(-dt * 2.5));
      c.target.y += dy;
      camera.position.y += dy;

      // drifting off while idle: ease back toward the island's heart
      if (idle > 24 && !world.holding) {
        const k = 1 - Math.exp(-dt * 0.15);
        tmp.copy(c.target);
        c.target.lerp(HOME_TARGET, k);
        camera.position.add(tmp.subVectors(c.target, tmp));
      }
    }

    // closer in, the camera may dip lower for a ground-level view
    c.maxPolarAngle = 1.32 + 0.16 * (1 - smoothstep(8, 26, dist));
    c.autoRotate = s.introDone && idle > 24 && !world.holding && !world.draggingTime;
    c.autoRotateSpeed = 0.16 * smoothstep(24, 32, idle);
    c.enabled = !world.holding && !world.draggingTime;
    // with a tool in hand, the left button / one finger belongs to the tool
    const hand = toolState.tool === "hand";
    c.mouseButtons.LEFT = hand ? MOUSE.ROTATE : (-1 as MOUSE);
    c.mouseButtons.RIGHT = hand ? MOUSE.PAN : MOUSE.ROTATE;
    c.touches.ONE = hand ? TOUCH.ROTATE : (-1 as TOUCH);
    c.touches.TWO = hand ? TOUCH.DOLLY_PAN : TOUCH.DOLLY_ROTATE;
    c.update();

    // never sink into the hills or the sea
    const floor = floorAt(camera.position.x, camera.position.z, world.elapsed) + 0.7;
    if (camera.position.y < floor) {
      camera.position.y = floor;
      camera.lookAt(c.target);
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.5}
      zoomSpeed={0.85}
      zoomToCursor
      enablePan
      screenSpacePanning={false}
      panSpeed={0.7}
      minDistance={4.5}
      maxDistance={55}
      minPolarAngle={0.22}
      maxPolarAngle={1.45}
      target={HOME_TARGET}
      onStart={() => {
        state.current.introDone = true;
        state.current.focusTarget = null;
      }}
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
    />
  );
}
