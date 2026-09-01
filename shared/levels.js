// Course definitions. Coordinates: x right, z "up" the fairway. y is up in 3D.

function rect(x0, z0, x1, z1) {
  return [
    { ax: x0, az: z0, bx: x1, bz: z0 },
    { ax: x1, az: z0, bx: x1, bz: z1 },
    { ax: x1, az: z1, bx: x0, bz: z1 },
    { ax: x0, az: z1, bx: x0, bz: z0 },
  ];
}

export const LEVELS = [
  {
    name: 'The Straight',
    par: 2,
    bounds: [-3, 0, 3, 13],
    tee: [0, 1.6],
    hole: { x: 0, z: 10.5, r: 0.35 },
    walls: rect(-3, 0, 3, 13),
    sand: [],
    posts: [],
  },
  {
    name: 'Dogleg',
    par: 3,
    bounds: [-4, 0, 8, 14],
    tee: [-2.2, 1.6],
    hole: { x: 5.2, z: 11.2, r: 0.35 },
    walls: [
      ...rect(-4, 0, 8, 14),
      { ax: -4, az: 7, bx: 2.2, bz: 7 }, // forces a route around the right side
    ],
    sand: [],
    posts: [],
  },
  {
    name: 'Sand Trap',
    par: 3,
    bounds: [-4, 0, 4, 15],
    tee: [0, 1.8],
    hole: { x: 0, z: 12, r: 0.35 },
    walls: rect(-4, 0, 4, 15),
    sand: [{ x: 0, z: 6.5, rx: 2.4, rz: 1.6 }],
    posts: [
      { x: -1.6, z: 9.4, r: 0.35 },
      { x: 1.6, z: 9.4, r: 0.35 },
    ],
  },
];

export function levelBounds(level) {
  return level.bounds;
}
