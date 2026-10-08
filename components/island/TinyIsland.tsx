"use client";

import dynamic from "next/dynamic";
import { emit, world } from "./lib/world";

if (typeof window !== "undefined") {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  world.mobile = coarse || window.innerWidth < 760;
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __island: unknown }).__island = { world, emit };
  }
}

const Experience = dynamic(() => import("./Experience"), { ssr: false });

export default function TinyIsland() {
  return (
    <main className="island-root">
      <Experience />
    </main>
  );
}
