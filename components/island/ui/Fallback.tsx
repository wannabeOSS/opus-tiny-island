"use client";

import { Component, type ReactNode } from "react";
import styles from "./hud.module.css";

export type FallbackReason = "nowebgl" | "lost" | "crash";

const COPY: Record<FallbackReason, { title: string; body: string; action?: string }> = {
  nowebgl: {
    title: "The island can't surface here",
    body: "This browser has 3D graphics (WebGL) turned off or unavailable. Try a recent Chrome, Safari, Firefox or Edge, or enable hardware acceleration.",
  },
  lost: {
    title: "The island dozed off",
    body: "Your device paused the 3D graphics to save power.",
    action: "Wake it up",
  },
  crash: {
    title: "A wave knocked something over",
    body: "Something went wrong while drawing the island.",
    action: "Try again",
  },
};

export function IslandFallback({ reason }: { reason: FallbackReason }) {
  const c = COPY[reason];
  return (
    <div className={styles.fallback} role="alert">
      <div className={styles.fallbackCard}>
        <h2>{c.title}</h2>
        <p>{c.body}</p>
        {c.action && (
          <button className={styles.btn} data-primary onClick={() => window.location.reload()}>
            {c.action}
          </button>
        )}
      </div>
    </div>
  );
}

function webglAvailable() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Catches scene errors, including the renderer failing to get a WebGL context at all. */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: FallbackReason | null }> {
  state: { failed: FallbackReason | null } = { failed: null };

  static getDerivedStateFromError() {
    return { failed: webglAvailable() ? "crash" : "nowebgl" };
  }

  componentDidCatch(error: unknown) {
    console.error("[tiny island]", error);
  }

  render() {
    return this.state.failed ? <IslandFallback reason={this.state.failed} /> : this.props.children;
  }
}
