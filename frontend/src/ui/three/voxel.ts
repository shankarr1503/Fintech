// A tiny voxel renderer: extrude pixel art into 3D blocks, rotate, light and project it to SVG paths.
//
// Why not three.js: the only 3D in CoinQuest is a handful of pixel objects (the coin, the lock), and
// a few hundred faces drawn with react-native-svg run everywhere Expo does (Expo Go, web, native)
// without a GL context or a megabyte of engine. Every object is lit by the same key light as the
// rest of the UI (top left, in front), so voxel shading, card glare and shadows always agree.

export type Vec3 = [number, number, number];
type Face = { corners: Vec3[]; normal: Vec3; color: string };
export type Mesh = { faces: Face[]; radius: number };

/** The one light in the app: up and to the left, towards the viewer. Shared with Tilt's glare. */
export const KEY_LIGHT: Vec3 = normalize([-0.55, 0.65, 0.55]);
const AMBIENT = 0.42;

/**
 * Extrude a sprite (rows of palette keys, '.' empty) into voxels `depth` cells thick.
 * Keys listed in `raised` stand `relief` further out of the front face (embossing, like the ₹ on
 * the coin). Only faces that touch empty space are kept: the inside is never drawn.
 */
export function meshFromSprite(rows: readonly string[], palette: Record<string, string>, depth = 2, raised = '', relief = 0.6): Mesh {
  const h = rows.length;
  const w = rows[0].length;
  const filled = (x: number, y: number) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
  const isRaised = (x: number, y: number) => filled(x, y) && raised.includes(rows[y][x]);
  const faces: Face[] = [];
  const zb = -depth / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!filled(x, y)) continue;
      const color = palette[rows[y][x]];
      const up = isRaised(x, y);
      const zf = depth / 2 + (up ? relief : 0);
      // Sprite space (x right, y down) to model space (x right, y up), centred on the origin.
      const x0 = x - w / 2;
      const x1 = x0 + 1;
      const y1 = h / 2 - y;
      const y0 = y1 - 1;
      faces.push({ color, normal: [0, 0, 1], corners: [[x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf]] });
      faces.push({ color, normal: [0, 0, -1], corners: [[x1, y0, zb], [x0, y0, zb], [x0, y1, zb], [x1, y1, zb]] });
      if (!filled(x - 1, y)) faces.push({ color, normal: [-1, 0, 0], corners: [[x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb]] });
      if (!filled(x + 1, y)) faces.push({ color, normal: [1, 0, 0], corners: [[x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf]] });
      if (!filled(x, y - 1)) faces.push({ color, normal: [0, 1, 0], corners: [[x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb]] });
      if (!filled(x, y + 1)) faces.push({ color, normal: [0, -1, 0], corners: [[x0, y0, zb], [x1, y0, zb], [x1, y0, zf], [x0, y0, zf]] });
      if (up) {
        // The embossed step's own walls, where a raised cell meets the plain face.
        const zs = depth / 2;
        if (filled(x - 1, y) && !isRaised(x - 1, y)) faces.push({ color, normal: [-1, 0, 0], corners: [[x0, y0, zs], [x0, y0, zf], [x0, y1, zf], [x0, y1, zs]] });
        if (filled(x + 1, y) && !isRaised(x + 1, y)) faces.push({ color, normal: [1, 0, 0], corners: [[x1, y0, zf], [x1, y0, zs], [x1, y1, zs], [x1, y1, zf]] });
        if (filled(x, y - 1) && !isRaised(x, y - 1)) faces.push({ color, normal: [0, 1, 0], corners: [[x0, y1, zf], [x1, y1, zf], [x1, y1, zs], [x0, y1, zs]] });
        if (filled(x, y + 1) && !isRaised(x, y + 1)) faces.push({ color, normal: [0, -1, 0], corners: [[x0, y0, zs], [x1, y0, zs], [x1, y0, zf], [x0, y0, zf]] });
      }
    }
  const radius = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2 + (depth / 2 + relief) ** 2);
  return { faces, radius };
}

export type Pose = { yaw: number; pitch: number };
export type Shape = { d: string; fill: string };

/**
 * Rotate (yaw about y, then pitch about x), cull faces turned away, shade by the key light and
 * project with a gentle perspective into a `size`-pixel square. Faces are painted far to near,
 * and consecutive faces of the same fill share one path, so a frame is a handful of SVG nodes.
 */
export function render(mesh: Mesh, pose: Pose, size: number): Shape[] {
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const rot = ([x, y, z]: Vec3): Vec3 => {
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const camera = mesh.radius * 4; // far enough that perspective is felt, not distorting
  const scale = (size / 2 / mesh.radius) * 0.92;
  const half = size / 2;

  const visible: { z: number; fill: string; pts: string }[] = [];
  for (const f of mesh.faces) {
    const n = rot(f.normal);
    if (n[2] <= 1e-4) continue; // facing away
    const light = AMBIENT + (1 - AMBIENT) * Math.max(0, dot(n, KEY_LIGHT));
    let zSum = 0;
    const pts = f.corners
      .map((c) => {
        const [x, y, z] = rot(c);
        zSum += z;
        const k = camera / (camera - z);
        return `${(half + x * k * scale).toFixed(1)},${(half - y * k * scale).toFixed(1)}`;
      })
      .join('L');
    visible.push({ z: zSum / 4, fill: shade(f.color, light), pts });
  }
  // Painter's order; ties broken by fill so co-planar faces merge into one path.
  visible.sort((a, b) => a.z - b.z || (a.fill < b.fill ? -1 : a.fill > b.fill ? 1 : 0));
  const shapes: Shape[] = [];
  for (const v of visible) {
    const last = shapes[shapes.length - 1];
    if (last && last.fill === v.fill) last.d += `M${v.pts}Z`;
    else shapes.push({ fill: v.fill, d: `M${v.pts}Z` });
  }
  return shapes;
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

const shadeCache = new Map<string, string>();
function shade(hex: string, k: number) {
  const key = `${hex}${k.toFixed(2)}`;
  const hit = shadeCache.get(key);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.min(255, Math.round(v * Math.round(k * 100) / 100)).toString(16).padStart(2, '0');
  const out = `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
  shadeCache.set(key, out);
  return out;
}
