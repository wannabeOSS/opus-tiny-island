"use client";

import dynamic from "next/dynamic";
import { height } from "./lib/terrain";
import { emit, on, world } from "./lib/world";

if (typeof window !== "undefined") {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  world.mobile = coarse || window.innerWidth < 760;
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __island: unknown }).__island = { world, emit, on, height };
  }
}

const Experience = dynamic(() => import("./Experience"), { ssr: false });
const Hud = dynamic(() => import("./ui/Hud"), { ssr: false });
const Cursor = dynamic(() => import("./ui/Cursor").then((m) => m.Cursor), { ssr: false });

export default function TinyIsland() {
  return (
    <main className="island-root">
      <Experience />
      <Hud />
      <Cursor />
    </main>
  );
}
