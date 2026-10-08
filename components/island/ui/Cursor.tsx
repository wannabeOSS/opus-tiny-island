"use client";

import { useEffect, useRef, useState } from "react";
import { toolState, type ToolKind } from "../lib/tools";
import { cursorState, type CursorKind } from "../world/cursor";
import { world } from "../lib/world";
import { HandFist, HandGrab, HandOpen, HandPoint, Pinwheel, TOOL_ICON } from "./icons";
import styles from "./hud.module.css";

const SIZE = 44;
/** where the "click" happens inside each 44px icon */
const HOTSPOT: Record<string, [number, number]> = {
  default: [21, 12],
  pointer: [16, 4],
  grab: [21, 14],
  grabbing: [21, 16],
  pinwheel: [22, 17],
  cloud: [22, 34],
  mirror: [18, 18],
  bubbles: [26, 19],
  seedbomb: [22, 27],
  conch: [12, 31],
};

type Look = { tool: ToolKind; kind: CursorKind; active: boolean };

export function Cursor() {
  const el = useRef<HTMLDivElement>(null);
  const rotor = useRef<SVGGElement>(null);
  const [look, setLook] = useState<Look>({ tool: "hand", kind: "default", active: false });
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const sync = () => setEnabled(fine.matches);
    sync();
    fine.addEventListener("change", sync);
    return () => fine.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const pos = { x: -100, y: -100, show: false };
    let raf = 0;
    let last = "";
    let wob = 0;
    let spin = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        pos.show = false;
        return;
      }
      pos.x = e.clientX;
      pos.y = e.clientY;
      pos.show = e.target instanceof HTMLCanvasElement;
    };
    const leave = () => {
      pos.show = false;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const tool = toolState.tool;
      const kind = cursorState.kind;
      const active = toolState.active;
      const key = `${tool}|${kind}|${active}`;
      if (key !== last) {
        last = key;
        setLook({ tool, kind, active });
      }
      const d = el.current;
      if (!d) return;
      const hk = tool === "hand" ? kind : tool;
      const [hx, hy] = HOTSPOT[hk] ?? [22, 22];
      wob += 0.25;
      let rot = 0;
      let press = 1;
      if (tool === "cloud") rot = Math.sin(wob * 0.3) * 4 + (active ? Math.sin(wob * 2.2) * 2 : 0);
      else if (tool === "mirror" && active) rot = -18 + Math.sin(wob * 0.5) * 5;
      else if (tool === "bubbles" && active) rot = Math.sin(wob * 0.8) * 14;
      else if (tool === "seedbomb" && active) press = 0.86;
      else if (tool === "conch" && active) {
        rot = -14;
        press = 1.12;
      }
      if (tool === "pinwheel") {
        const drag = Math.hypot(toolState.dragVel.x, toolState.dragVel.y);
        spin += 2 + world.windStrength * 6 + (active ? Math.min(40, drag / 60) : 0);
        rotor.current?.setAttribute("transform", `rotate(${spin % 360} 16 12.5)`);
      }
      d.style.opacity = pos.show ? "1" : "0";
      d.style.transform = `translate3d(${pos.x - hx}px, ${pos.y - hy}px, 0) rotate(${rot}deg) scale(${press})`;
      d.style.transformOrigin = `${hx}px ${hy}px`;
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    raf = requestAnimationFrame(tick);
    document.documentElement.classList.add("island-custom-cursor");
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      document.documentElement.classList.remove("island-custom-cursor");
    };
  }, [enabled]);

  if (!enabled) return null;
  const Icon =
    look.tool === "hand"
      ? look.kind === "pointer"
        ? HandPoint
        : look.kind === "grab"
          ? HandGrab
          : look.kind === "grabbing"
            ? HandFist
            : HandOpen
      : TOOL_ICON[look.tool];
  return (
    <div ref={el} className={styles.cursor} aria-hidden="true">
      {look.tool === "pinwheel" ? <Pinwheel size={SIZE} rotorRef={rotor} /> : <Icon size={SIZE} />}
    </div>
  );
}
