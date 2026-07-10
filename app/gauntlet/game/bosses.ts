export type Boss = {
  id: string;
  name: string;
  title: string;
  hp: number;
  /** arena accent colors */
  glow: string;
  arena: string; // css gradient background for the arena
  /** taunts shown on player mistakes */
  taunt: string;
};

export const BOSSES: Boss[] = [
  {
    id: "clank",
    name: "Clank",
    title: "Lab Sentinel",
    hp: 600,
    glow: "#22d3ee",
    arena:
      "radial-gradient(80% 60% at 50% 30%, #123243 0%, #0b1f2c 55%, #071520 100%)",
    taunt: "Beep. Recalculate!",
  },
  {
    id: "gloop",
    name: "Gloop",
    title: "Swamp Slime",
    hp: 900,
    glow: "#84cc16",
    arena:
      "radial-gradient(80% 60% at 50% 30%, #1c3222 0%, #10221a 55%, #081410 100%)",
    taunt: "Blub blub… wrong!",
  },
  {
    id: "magmar",
    name: "Magmar",
    title: "Molten Golem",
    hp: 1400,
    glow: "#f97316",
    arena:
      "radial-gradient(80% 60% at 50% 30%, #3a1d14 0%, #24120c 55%, #140a07 100%)",
    taunt: "Your math… crumbles!",
  },
  {
    id: "vex",
    name: "Vex",
    title: "Cannon Core",
    hp: 2000,
    glow: "#60a5fa",
    arena:
      "radial-gradient(80% 60% at 50% 30%, #1f2340 0%, #14162b 55%, #0b0c1c 100%)",
    taunt: "Target reacquired.",
  },
];
