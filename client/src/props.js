// Small models used around the world: the sneakers in the WINS SHOP and OP Shoes stands, the
// golden trophy over the Wins pads, little wings for the winged shoes.
import { T, candy, mat, matte } from './engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const G = {
    box: new T.BoxGeometry(1, 1, 1),
    sphere: new T.SphereGeometry(1, 14, 10),
    sphereLo: new T.SphereGeometry(1, 8, 6),
    torus: new T.TorusGeometry(1, 0.42, 7, 15),
};

// Feathered wings (Dragon / Galaxy shoes)
function featherWings(color) {
    const g = new T.Group();
    for (const side of [-1, 1]) {
        const w = new T.Group();
        w.position.set(side * 0.4, 0, 0);
        [[6, 2.1, 0.36], [6, 1.55, 0.33], [7, 1.05, 0.28]].forEach(([n, len, wd], r) => {
            for (let k = 0; k < n; k++) {
                const a = -0.6 + (k / (n - 1)) * 1.55;
                const dx = side * Math.cos(a), dy = Math.sin(a), reach = 0.35 + len * 0.5;
                const f = new T.Mesh(G.sphereLo, candy(r === 2 ? 0xffffff : color, { rough: 0.6 }));
                f.scale.set(wd, len * 0.5, 0.09);
                f.position.set(dx * reach, dy * reach + 0.3 - r * 0.18, -0.06 * (2 - r));
                f.rotation.z = Math.atan2(-dx, dy);
                w.add(f);
            }
        });
        g.add(w);
    }
    return g;
}

// A sneaker: sole, upper, toe box, ankle, collar, laces, side stripes, heel tab (+ glow strip)
export function buildShoe(def) {
    const g = new T.Group();
    const body = candy(def.color, { rough: 0.35, clear: true });
    const acc = candy(def.accent, { rough: 0.3 });
    const white = candy(0xffffff, { rough: 0.55 });
    const part = (geo, m, x, y, z, sx, sy, sz, rx) => {
        const p = new T.Mesh(geo, m); p.position.set(x, y, z); p.scale.set(sx, sy, sz); if (rx) p.rotation.x = rx; p.castShadow = true; g.add(p); return p;
    };
    part(G.box, white, 0, 0.16, 0, 1.12, 0.32, 2.5);
    part(G.sphereLo, white, 0, 0.16, 1.18, 0.56, 0.17, 0.2);
    part(G.box, body, 0, 0.62, -0.32, 1.02, 0.7, 1.66);
    part(G.sphere, body, 0, 0.5, 0.6, 0.52, 0.36, 0.72);
    part(G.box, body, 0, 1.02, -0.72, 0.98, 0.32, 0.86);
    part(G.torus, acc, 0, 1.2, -0.72, 0.42, 0.42, 0.5, Math.PI / 2);
    for (let k = 0; k < 3; k++) part(G.box, white, 0, 0.98 - k * 0.08, 0.05 + k * 0.24, 0.62, 0.07, 0.09);
    for (const s of [-1, 1]) part(G.box, acc, s * 0.52, 0.6, -0.15, 0.04, 0.22, 1.3);
    part(G.box, acc, 0, 0.92, -1.2, 0.3, 0.5, 0.12);
    if (def.glow) {
        const strip = new T.Mesh(G.box, mat(def.glow, { neon: true }));
        strip.scale.set(1.16, 0.08, 2.54); strip.position.set(0, 0.06, 0); g.add(strip);
    }
    if (def.wings) {
        const w = featherWings(def.accent);
        w.scale.setScalar(0.32); w.position.set(0, 0.85, -0.5); w.rotation.y = Math.PI / 2;
        g.add(w);
    }
    return g;
}

// Gold trophy (cup, handles, stem, base) as one merged geometry
export const TROPHY_GEO = (() => {
    const prof = [[0, 1.0], [0.55, 1.0], [0.9, 1.25], [1.05, 1.7], [1.12, 2.25], [1.0, 2.32], [0.9, 2.15], [0.84, 1.8], [0.68, 1.42], [0.4, 1.16], [0, 1.16]].map(([r, y]) => new T.Vector2(r, y));
    const cup = new T.LatheGeometry(prof, 22);
    const stem = new T.CylinderGeometry(0.18, 0.3, 0.6, 12).translate(0, 0.72, 0);
    const base = new T.CylinderGeometry(0.75, 0.88, 0.45, 22).translate(0, 0.22, 0);
    const h1 = new T.TorusGeometry(0.42, 0.11, 8, 16, Math.PI).rotateZ(-Math.PI / 2).translate(1.06, 1.86, 0);
    const h2 = h1.clone().rotateY(Math.PI);
    const g = mergeGeometries([cup, stem, base, h1, h2]);
    g.computeVertexNormals();
    return g;
})();
// Matte gold with a warm glow (no reflections)
export const GOLD = matte({ color: 0xffc828, emissive: 0x8a5a00, emissiveIntensity: 0.4 });
// The red cup inside the reference's trophies
export const CUP_RED = matte({ color: 0xe8202a });
export function trophy(scale) {
    const g = new T.Group();
    const m = new T.Mesh(TROPHY_GEO, GOLD); m.castShadow = true; g.add(m);
    const inner = new T.Mesh(new T.CircleGeometry(0.98, 20), CUP_RED); inner.rotation.x = -Math.PI / 2; inner.position.y = 2.2; g.add(inner);
    g.scale.setScalar(scale || 1);
    return g;
}
