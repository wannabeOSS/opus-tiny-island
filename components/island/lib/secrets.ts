import { sfx } from "./world";

export type SecretId =
  | "timekeeper"
  | "bottle"
  | "goldfish"
  | "whale"
  | "lanternTree"
  | "visitor"
  | "wish"
  | "ghostShip"
  | "midnightTide"
  | "skipper"
  | "rainbow"
  | "moonflower"
  | "temper"
  | "bounce";

export type Secret = { id: SecretId; title: string; note: string; clue: string };

export const SECRETS: Secret[] = [
  { id: "timekeeper", title: "Time keeper", note: "The sun can be moved by hand.", clue: "Something in the sky can be held." },
  { id: "bottle", title: "Message in a bottle", note: "The tide brought a bottle with a seed inside.", clue: "Watch the shoreline." },
  { id: "lanternTree", title: "The lantern tree", note: "The seed grew into a tree of singing lights.", clue: "Some seeds want rain, sun and company." },
  { id: "goldfish", title: "Golden fish", note: "Fed enough, a golden fish came to visit.", clue: "Someone in the lagoon is hungry." },
  { id: "whale", title: "Old friend", note: "Three flashes of the lighthouse at night called a whale.", clue: "The lighthouse talks to the deep at night." },
  { id: "visitor", title: "A quiet visitor", note: "Stay still long enough and a rabbit comes out.", clue: "Patience is rewarded." },
  { id: "wish", title: "A wish", note: "Touching the moon sends a shooting star.", clue: "Reach for the moon." },
  { id: "ghostShip", title: "The ship in the storm", note: "A ship sails the horizon only during storms.", clue: "Look out to sea when the weather turns." },
  { id: "midnightTide", title: "Midnight tide", note: "At midnight the sea glows where it is touched.", clue: "The sea keeps late hours." },
  { id: "skipper", title: "Stone skipper", note: "A pebble skimmed the sea three times.", clue: "Throw low and fast." },
  { id: "rainbow", title: "After the rain", note: "Sun after rain paints a rainbow.", clue: "Wait for the rain to clear." },
  { id: "moonflower", title: "Moonflower", note: "The pale bud by the lighthouse opens when watered at night.", clue: "A bud on the cliff is thirsty after dark." },
  { id: "temper", title: "Short temper", note: "Poke a raining cloud enough and it throws lightning.", clue: "Clouds don't like to be poked." },
  { id: "bounce", title: "Boing", note: "The big red mushroom is very bouncy.", clue: "Throw something at the big mushroom." },
];

type Listener = (id: SecretId | null) => void;
const listeners = new Set<Listener>();
export const found = new Set<SecretId>();

const KEY = "tiny-island-secrets";
if (typeof window !== "undefined") {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SecretId[];
    saved.forEach((s) => found.add(s));
  } catch {
    // ignore
  }
}

export function discover(id: SecretId) {
  if (found.has(id)) return false;
  found.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...found]));
  } catch {
    // ignore
  }
  sfx("secret", undefined, 0.6);
  listeners.forEach((l) => l(id));
  return true;
}

export function forgetSecrets() {
  found.clear();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l(null));
}

export function onSecret(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
