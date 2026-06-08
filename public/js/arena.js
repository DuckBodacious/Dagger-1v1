import * as THREE from 'three';
import { CONFIG } from './config.js?v=6';

// All collidable boxes for AABB collision checks (used by both client and server)
// Each box: { minX, minY, minZ, maxX, maxY, maxZ, destructible?, type? }
export const COLLISION_BOXES = [];

// Arena definition — returns the Three.js meshes for rendering
export function buildArena(scene) {
    COLLISION_BOXES.length = 0;

    const materials = createMaterials();
    const allMeshes = [];

    // ─── Main Building (Bernal-inspired, centered at origin) ───
    const bw = CONFIG.BUILDING_WIDTH;    // 14m
    const bd = CONFIG.BUILDING_DEPTH;    // 10m
    const fh = CONFIG.FLOOR_HEIGHT;      // 3.5m
    const wallThick = 0.3;
    const floorThick = 0.25;

    // Building origin offsets (centered)
    const bx = -bw / 2;
    const bz = -bd / 2;

    // ═══════════════════════════════════════════════
    // GROUND FLOOR (y: 0 → 3.5)
    // ═══════════════════════════════════════════════

    // Floor slab (ground level is the arena ground, no extra slab needed)

    // Outer walls — Ground Floor
    // Front wall (z = bz, facing -Z) with two doorways
    addWall(scene, allMeshes, materials.concrete, bx, 0, bz, 4.0, fh, wallThick);             // left section
    addWall(scene, allMeshes, materials.concrete, bx + 4.0, fh - 1.0, bz, 2.0, 1.0, wallThick); // above door 1
    addWall(scene, allMeshes, materials.concrete, bx + 6.0, 0, bz, 2.0, fh, wallThick);       // middle section
    addWall(scene, allMeshes, materials.concrete, bx + 8.0, fh - 1.0, bz, 2.0, 1.0, wallThick); // above door 2
    addWall(scene, allMeshes, materials.concrete, bx + 10.0, 0, bz, 4.0, fh, wallThick);      // right section

    // Back wall (z = bz + bd) with one doorway
    addWall(scene, allMeshes, materials.concrete, bx, 0, bz + bd - wallThick, 5.5, fh, wallThick);
    addWall(scene, allMeshes, materials.concrete, bx + 5.5, fh - 1.0, bz + bd - wallThick, 3.0, 1.0, wallThick);
    addWall(scene, allMeshes, materials.concrete, bx + 8.5, 0, bz + bd - wallThick, 5.5, fh, wallThick);

    // Left wall (x = bx) — solid
    addWall(scene, allMeshes, materials.concrete, bx, 0, bz + wallThick, wallThick, fh, bd - wallThick * 2);

    // Right wall (x = bx + bw) with windows
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, 0, bz + wallThick, wallThick, 1.2, bd - wallThick * 2);           // below windows
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, fh - 0.8, bz + wallThick, wallThick, 0.8, bd - wallThick * 2);    // above windows
    // Window pillars — start at 1.201 (above "below windows" top at y=1.2) and
    // end at fh-0.801 (below "above windows" bottom at y=fh-0.8) so neither the
    // bottom nor top face sits coplanar with adjacent sections (z-fighting fix)
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, 1.201, bz + wallThick, wallThick, fh - 2.001 - 0.001, 0.5);
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, 1.201, bz + bd / 2 - 0.25, wallThick, fh - 2.001 - 0.001, 0.5);
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, 1.201, bz + bd - wallThick - 0.5, wallThick, fh - 2.001 - 0.001, 0.5);

    // Interior wall — divides ground floor into lobby (front) and back room
    // Height ends at mid-slab so tops are buried inside the upper floor slab —
    // avoids coplanar with both slab top (y=fh) AND slab bottom (y=fh-floorThick)
    addWall(scene, allMeshes, materials.interiorWall, bx + wallThick, 0, bz + bd * 0.55, bw * 0.4, fh - floorThick * 0.5, wallThick);
    addWall(scene, allMeshes, materials.interiorWall, bx + bw * 0.4 + wallThick + 1.5, 0, bz + bd * 0.55, bw * 0.6 - wallThick - 1.5, fh - floorThick * 0.5, wallThick);
    // doorway above in interior wall
    addWall(scene, allMeshes, materials.interiorWall, bx + bw * 0.4 + wallThick, fh - 1.0, bz + bd * 0.55, 1.5, 1.0 - floorThick * 0.5, wallThick);

    // ─── Staircase (ground → upper) ───
    // Left side of building, moved into the lobby for accessibility
    const stairWidth = 1.5;
    const stairDepth = 3.0;
    const numSteps = 10;
    const stepHeight = fh / numSteps;
    const stepDepth = stairDepth / numSteps;
    const stairStartZ = bz + bd * 0.2; // 20% into building — clear of the front wall
    for (let i = 0; i < numSteps; i++) {
        addStep(scene, allMeshes, materials.metal,
            bx + wallThick + 0.2, i * stepHeight, stairStartZ + i * stepDepth,
            stairWidth, stepHeight, stepDepth);
    }
    // No railing

    // ═══════════════════════════════════════════════
    // UPPER FLOOR (y: 3.5 → 7.0)
    // ═══════════════════════════════════════════════

    // Floor slab (ceiling of ground floor)
    addFloor(scene, allMeshes, materials.concreteFloor, bx, fh - floorThick, bz, bw, floorThick, bd);
    // Cut hole for stairs (remove collision, add opening visually — we skip the slab in stair area)
    // For simplicity, the stair area slab is thinner / we just let players clip through.
    // Actually, let's add the floor but leave a gap:
    // Remove the full floor, add it in two pieces with a stair hole
    COLLISION_BOXES.pop(); // remove last (the full floor slab)
    scene.remove(allMeshes.pop());
    // Floor piece 1: front of stair hole — inset by wallThick on exterior sides (left, right, front)
    // Extended 0.001m into piece 2 so their shared face is no longer coplanar (z-fighting fix)
    addFloor(scene, allMeshes, materials.concreteFloor, bx + wallThick - 0.001, fh - floorThick, bz + wallThick - 0.001, bw - wallThick * 2 + 0.002, floorThick, bd * 0.18 - wallThick + 0.002);
    // Floor piece 2: right of stair hole — right face extended 0.001m into right outer wall
    addFloor(scene, allMeshes, materials.concreteFloor, bx + wallThick + stairWidth + 0.5, fh - floorThick, bz + bd * 0.18, bw - wallThick * 2 - stairWidth - 0.5 + 0.001, floorThick, stairDepth + 0.501);
    // Floor piece 3: behind stair hole — left/right faces extended into outer walls, back already extends into back wall
    addFloor(scene, allMeshes, materials.concreteFloor, bx + wallThick - 0.001, fh - floorThick, bz + bd * 0.18 + stairDepth + 0.5, bw - wallThick * 2 + 0.002, floorThick, bd - bd * 0.18 - stairDepth - 0.5 - wallThick + 0.001);

    // Upper floor outer walls — start at fh+0.001 so their bottom face doesn't
    // sit coplanar with the upper floor slab top face (z-fighting fix)
    const ε = 0.001;
    // Front wall with balcony opening
    addWall(scene, allMeshes, materials.concrete, bx, fh + ε, bz, 3.0, fh - ε, wallThick);
    addWall(scene, allMeshes, materials.concrete, bx + 3.0, fh + fh - 0.8, bz, 8.0, 0.8, wallThick);  // above balcony
    addWall(scene, allMeshes, materials.concrete, bx + 3.0, fh + ε, bz, 8.0, 1.0 - ε, wallThick);     // balcony railing height
    addWall(scene, allMeshes, materials.concrete, bx + 11.0, fh + ε, bz, 3.0, fh - ε, wallThick);

    // Back wall — solid
    addWall(scene, allMeshes, materials.concrete, bx, fh + ε, bz + bd - wallThick, bw, fh - ε, wallThick);

    // Left wall — solid
    addWall(scene, allMeshes, materials.concrete, bx, fh + ε, bz + wallThick, wallThick, fh - ε, bd - wallThick * 2);

    // Right wall — with windows
    // Lower section ends at fh+1.2, pillar starts at fh+1.2 — offset pillar by ε
    // to avoid coplanar bottom face. Pillar also ends at fh+fh-0.8 same as upper
    // section bottom — shorten by ε to avoid that too. (z-fighting fix)
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, fh + ε, bz + wallThick, wallThick, 1.2 - ε, bd - wallThick * 2);
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, fh + fh - 0.8, bz + wallThick, wallThick, 0.8, bd - wallThick * 2);
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, fh + 1.2 + ε, bz + bd / 2 - 0.25, wallThick, fh - 2.0 - 2 * ε, 0.5);

    // Interior walls — two rooms on upper floor
    // Height ends at mid-slab (fh - floorThick*0.5) so wall top is buried inside
    // the roof slab — avoids coplanar with both slab top (y=2*fh) AND slab bottom
    // (y=2*fh-floorThick) (z-fighting fix)
    addWall(scene, allMeshes, materials.interiorWall, bx + bw * 0.5, fh + ε, bz + wallThick, wallThick, fh - floorThick * 0.5 - ε, bd * 0.4);
    addWall(scene, allMeshes, materials.interiorWall, bx + bw * 0.5, fh + ε, bz + bd * 0.4 + wallThick + 1.2, wallThick, fh - floorThick * 0.5 - ε, bd * 0.6 - wallThick - 1.2);
    addWall(scene, allMeshes, materials.interiorWall, bx + bw * 0.5, fh + fh - 1.0, bz + bd * 0.4 + wallThick, wallThick, 1.0, 1.2);

    // ─── Staircase (upper → rooftop) ───
    // Back-right corner
    for (let i = 0; i < numSteps; i++) {
        addStep(scene, allMeshes, materials.metal,
            bx + bw - wallThick - stairWidth - 0.2, fh + i * stepHeight, bz + bd - wallThick - stairDepth - 0.3 + i * stepDepth,
            stairWidth, stepHeight, stepDepth);
    }
    // No railing

    // ═══════════════════════════════════════════════
    // ROOFTOP (y: 7.0 → open sky)
    // ═══════════════════════════════════════════════

    // Roof slab
    addFloor(scene, allMeshes, materials.concreteFloor, bx, fh * 2 - floorThick, bz, bw, floorThick, bd);
    // Stair hole in roof
    COLLISION_BOXES.pop();
    scene.remove(allMeshes.pop());
    // Roof piece 1: left of stair opening — extended 0.001m rightward into piece 2 so their
    // shared face at x=bx+bw-wallThick-stairWidth-0.7 is no longer coplanar (z-fighting fix)
    addFloor(scene, allMeshes, materials.concreteFloor, bx + wallThick - 0.001, fh * 2 - floorThick, bz + wallThick - 0.001, bw - wallThick * 2 - stairWidth - 0.699 + 0.001, floorThick, bd - wallThick * 2 + 0.002);
    // Roof piece 2: right of stair opening — right face into right outer wall, front face into front outer wall
    addFloor(scene, allMeshes, materials.concreteFloor, bx + bw - wallThick - stairWidth - 0.7, fh * 2 - floorThick, bz + wallThick - 0.001, stairWidth + 0.7 + 0.001, floorThick, bd - wallThick * 2 - stairDepth - 0.8 + 0.001);

    // Rooftop parapet walls — start at fh*2+ε so their bottom face doesn't sit
    // coplanar with the roof slab top face (z-fighting fix)
    const parapetH = 1.0;
    addWall(scene, allMeshes, materials.concrete, bx, fh * 2 + ε, bz, bw, parapetH - ε, wallThick);                        // front
    addWall(scene, allMeshes, materials.concrete, bx, fh * 2 + ε, bz + bd - wallThick, bw, parapetH - ε, wallThick);        // back
    addWall(scene, allMeshes, materials.concrete, bx, fh * 2 + ε, bz + wallThick, wallThick, parapetH - ε, bd - wallThick * 2);  // left
    addWall(scene, allMeshes, materials.concrete, bx + bw - wallThick, fh * 2 + ε, bz + wallThick, wallThick, parapetH - ε, bd - wallThick * 2); // right

    // Rooftop cover blocks (AC units, vents)
    addWall(scene, allMeshes, materials.metalDark, bx + 2, fh * 2 + ε, bz + 2, 1.5, 1.2, 1.0);
    addWall(scene, allMeshes, materials.metalDark, bx + bw - 4, fh * 2 + ε, bz + bd - 3, 2.0, 0.8, 1.5);

    // ═══════════════════════════════════════════════
    // EXTERIOR COVER OBJECTS
    // ═══════════════════════════════════════════════

    // ─── Concrete barriers (indestructible) ───
    addCover(scene, allMeshes, materials.concreteBarrier, -10, 0, -8, 2.0, 1.0, 0.4);
    addCover(scene, allMeshes, materials.concreteBarrier, 10, 0, -8, 2.0, 1.0, 0.4);
    addCover(scene, allMeshes, materials.concreteBarrier, -10, 0, 8, 2.0, 1.0, 0.4);
    addCover(scene, allMeshes, materials.concreteBarrier, 10, 0, 8, 2.0, 1.0, 0.4);
    // Angled barriers near building entrances
    addCover(scene, allMeshes, materials.concreteBarrier, -2, 0, -7, 3.0, 1.0, 0.4);
    addCover(scene, allMeshes, materials.concreteBarrier, 2, 0, 7, 3.0, 1.0, 0.4);

    // ─── Short walls ───
    addCover(scene, allMeshes, materials.concrete, -14, 0, 0, 0.3, 1.6, 4.0);
    addCover(scene, allMeshes, materials.concrete, 14, 0, 0, 0.3, 1.6, 4.0);
    addCover(scene, allMeshes, materials.concrete, 0, 0, -14, 4.0, 1.6, 0.3);
    addCover(scene, allMeshes, materials.concrete, 0, 0, 14, 4.0, 1.6, 0.3);

    // ─── Crates (destructible) ───
    addCrate(scene, allMeshes, materials.woodCrate, -12, 0, -4, 1.0, 1.0, 1.0);
    addCrate(scene, allMeshes, materials.woodCrate, -12, 1.0, -4, 1.0, 1.0, 1.0); // stacked
    addCrate(scene, allMeshes, materials.woodCrate, 12, 0, 4, 1.0, 1.0, 1.0);
    addCrate(scene, allMeshes, materials.woodCrate, 12, 1.0, 4, 1.0, 1.0, 1.0);
    addCrate(scene, allMeshes, materials.woodCrate, -8, 0, 12, 1.2, 1.2, 1.2);
    addCrate(scene, allMeshes, materials.woodCrate, 8, 0, -12, 1.2, 1.2, 1.2);
    addCrate(scene, allMeshes, materials.woodCrate, -5, 0, -12, 0.8, 0.8, 0.8);
    addCrate(scene, allMeshes, materials.woodCrate, 5, 0, 12, 0.8, 0.8, 0.8);

    // ─── Chain-link fences (visual only, shoot-through) ───
    addFence(scene, allMeshes, -16, 0, -6, 0.05, 2.5, 6.0);
    addFence(scene, allMeshes, 16, 0, 6, 0.05, 2.5, 6.0);

    // ─── Barrel positions (stored for destructible.js to use) ───
    // These are just visual markers — actual barrel logic goes in destructible.js
    const barrelPositions = {
        explosive: [
            { x: -4, z: -9 },
            { x: 4, z: 9 },
            { x: -13, z: 5 },
            { x: 13, z: -5 },
            { x: bx + 3, z: bz + bd * 0.3 },  // inside building ground floor
            { x: bx + bw - 2, z: bz + bd * 0.7 },
        ],
        goo: [
            { x: -9, z: -2 },
            { x: 9, z: 2 },
            { x: 0, z: 12 },
        ],
    };

    // Place barrel meshes
    for (const pos of barrelPositions.explosive) {
        addBarrelMesh(scene, allMeshes, materials.barrelExplosive, pos.x, 0, pos.z, 'explosive');
    }
    for (const pos of barrelPositions.goo) {
        addBarrelMesh(scene, allMeshes, materials.barrelGoo, pos.x, 0, pos.z, 'goo');
    }

    return { meshes: allMeshes, barrelPositions };
}

// ═══════════════════════════════════════════════
// Helper: Add a wall (box geometry + collision)
// ═══════════════════════════════════════════════
function addWall(scene, meshes, material, x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);

    COLLISION_BOXES.push({
        minX: x, minY: y, minZ: z,
        maxX: x + w, maxY: y + h, maxZ: z + d,
        type: 'wall',
    });
}

// addStep: visual identical to addWall but collision type is 'stair_step' so the
// collision resolver snaps the player UP onto it instead of blocking horizontally.
function addStep(scene, meshes, material, x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);

    COLLISION_BOXES.push({
        minX: x, minY: y, minZ: z,
        maxX: x + w, maxY: y + h, maxZ: z + d,
        type: 'stair_step',
    });
}

function addFloor(scene, meshes, material, x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);

    COLLISION_BOXES.push({
        minX: x, minY: y, minZ: z,
        maxX: x + w, maxY: y + h, maxZ: z + d,
        type: 'floor',
    });
}

function addCover(scene, meshes, material, x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes.push(mesh);

    COLLISION_BOXES.push({
        minX: x, minY: y, minZ: z,
        maxX: x + w, maxY: y + h, maxZ: z + d,
        type: 'cover',
    });
}

function addCrate(scene, meshes, material, x, y, z, w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.destructible = true;
    mesh.userData.hp = 50;
    scene.add(mesh);
    meshes.push(mesh);

    COLLISION_BOXES.push({
        minX: x, minY: y, minZ: z,
        maxX: x + w, maxY: y + h, maxZ: z + d,
        type: 'crate',
        destructible: true,
        hp: 50,
        meshIndex: meshes.length - 1,
    });
}

function addFence(scene, meshes, x, y, z, w, h, d) {
    // Fences are visual only — no collision (shoot-through)
    const geo = new THREE.PlaneGeometry(d, h);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        wireframe: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z + d / 2);
    // Orient based on which dimension is thin
    if (w < d) {
        // facing X
    } else {
        mesh.rotation.y = Math.PI / 2;
    }
    scene.add(mesh);
    meshes.push(mesh);
    // No collision box — shoot-through
}

function addBarrelMesh(scene, meshes, material, x, y, z, type) {
    const radius = 0.35;
    const height = 0.9;
    const geo = new THREE.CylinderGeometry(radius, radius, height, 8);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.barrel = type;
    scene.add(mesh);
    meshes.push(mesh);

    COLLISION_BOXES.push({
        minX: x - radius, minY: y, minZ: z - radius,
        maxX: x + radius, maxY: y + height, maxZ: z + radius,
        type: 'barrel',
        barrelType: type,
    });
}

// ═══════════════════════════════════════════════
// Materials
// ═══════════════════════════════════════════════
// Helper: apply polygon offset to a material so coplanar faces don't z-fight
function solidMat(params) {
    const mat = new THREE.MeshStandardMaterial(params);
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
    return mat;
}

function createMaterials() {
    return {
        concrete: solidMat({
            color: 0x8a8a7a,
            roughness: 0.85,
            metalness: 0.05,
        }),
        concreteFloor: solidMat({
            color: 0x6e6e62,
            roughness: 0.9,
            metalness: 0.05,
        }),
        concreteBarrier: solidMat({
            color: 0x999988,
            roughness: 0.8,
            metalness: 0.05,
        }),
        interiorWall: solidMat({
            color: 0xa09880,
            roughness: 0.75,
            metalness: 0.02,
        }),
        metal: solidMat({
            color: 0x666672,
            roughness: 0.5,
            metalness: 0.6,
        }),
        metalDark: solidMat({
            color: 0x444450,
            roughness: 0.6,
            metalness: 0.5,
        }),
        metalRailing: new THREE.MeshStandardMaterial({
            color: 0x555560,
            roughness: 0.5,
            metalness: 0.7,
            transparent: true,
            opacity: 0.8,
        }),
        woodCrate: solidMat({
            color: 0x8B6914,
            roughness: 0.8,
            metalness: 0.0,
        }),
        barrelExplosive: solidMat({
            color: 0xcc3333,
            roughness: 0.5,
            metalness: 0.3,
            emissive: 0x331111,
            emissiveIntensity: 0.3,
        }),
        barrelGoo: solidMat({
            color: 0x33cc66,
            roughness: 0.4,
            metalness: 0.2,
            emissive: 0x113311,
            emissiveIntensity: 0.3,
        }),
    };
}

// ═══════════════════════════════════════════════
// AABB Collision Check (used by movement system)
// Player is approximated as a vertical cylinder / box
// ═══════════════════════════════════════════════
export function checkCollision(player, newX, newY, newZ) {
    const r = CONFIG.PLAYER_RADIUS;
    const halfH = player.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / 2 : CONFIG.PLAYER_HEIGHT / 2;

    // Player AABB at proposed position
    const pMinX = newX - r;
    const pMaxX = newX + r;
    const pMinY = newY - halfH;
    const pMaxY = newY + halfH;
    const pMinZ = newZ - r;
    const pMaxZ = newZ + r;

    let resolvedX = newX;
    let resolvedY = newY;
    let resolvedZ = newZ;
    let groundHit = false;
    let ceilingHit = false;
    let wallHit = false;
    let wallHitX = false;
    let wallHitZ = false;
    let wallTopY = 0;

    // Ground plane
    if (pMinY <= 0) {
        resolvedY = halfH;
        groundHit = true;
    }

    // Arena bounds
    const half = CONFIG.ARENA_SIZE / 2;
    if (resolvedX - r < -half) { resolvedX = -half + r; wallHitX = true; }
    if (resolvedX + r > half) { resolvedX = half - r; wallHitX = true; }
    if (resolvedZ - r < -half) { resolvedZ = -half + r; wallHitZ = true; }
    if (resolvedZ + r > half) { resolvedZ = half - r; wallHitZ = true; }

    // Check against all collision boxes
    for (const box of COLLISION_BOXES) {
        // AABB overlap test with resolved position (iterate to handle multiple)
        const pMX = resolvedX - r;
        const pPX = resolvedX + r;
        const pMY = resolvedY - halfH;
        const pPY = resolvedY + halfH;
        const pMZ = resolvedZ - r;
        const pPZ = resolvedZ + r;

        if (pPX <= box.minX || pMX >= box.maxX) continue;
        if (pPZ <= box.minZ || pMZ >= box.maxZ) continue;

        // Swept-Y: catch fast-moving players (e.g. jump pad) passing through thin floors
        const prevFeetY = player.y - halfH;
        const prevHeadY = player.y + halfH;
        if (player.vy < 0 && prevFeetY >= box.maxY && pMY < box.maxY) {
            if (resolvedY > box.maxY + halfH || !groundHit) {
                resolvedY = box.maxY + halfH;
                groundHit = true;
            }
            continue;
        }
        if (player.vy > 0 && prevHeadY <= box.minY && pPY > box.minY) {
            resolvedY = box.minY - halfH;
            ceilingHit = true;
            continue;
        }

        if (pPY <= box.minY || pMY > box.maxY) continue;

        // Stair steps: snap player up onto the surface, never block horizontally.
        // Only snap if step top is within one STEP_HEIGHT of where the player started this frame.
        if (box.type === 'stair_step') {
            const stepTop = box.maxY;
            const playerFeetY = resolvedY - halfH;
            if (stepTop > playerFeetY &&
                stepTop <= newY - halfH + CONFIG.STEP_HEIGHT &&  // reachable from start Y
                player.vy <= 0) {
                resolvedY = stepTop + halfH;
                groundHit = true;
            }
            continue;
        }

        // Collision! Determine the axis of minimum penetration
        const overlapLeft = pPX - box.minX;
        const overlapRight = box.maxX - pMX;
        const overlapBottom = pPY - box.minY;
        const overlapTop = box.maxY - pMY;
        const overlapFront = pPZ - box.minZ;
        const overlapBack = box.maxZ - pMZ;

        const minOverlap = Math.min(overlapLeft, overlapRight, overlapBottom, overlapTop, overlapFront, overlapBack);

        if (minOverlap === overlapBottom && player.vy <= 0) {
            // Landing on top of box
            resolvedY = box.maxY + halfH;
            groundHit = true;
        } else if (minOverlap === overlapBottom && player.vy > 0) {
            // Moving upward into the underside of a surface (jump pad, etc.) — stop and push down
            resolvedY = box.minY - halfH;
            ceilingHit = true;
        } else if (minOverlap === overlapTop && resolvedY < box.minY) {
            // Hitting ceiling from below (deep penetration)
            resolvedY = box.minY - halfH;
            ceilingHit = true;
        } else if (minOverlap === overlapTop) {
            // Player center is above box bottom but sinking through top — snap onto surface
            resolvedY = box.maxY + halfH;
            groundHit = true;
        } else if (minOverlap === overlapLeft) {
            resolvedX = box.minX - r;
            wallHitX = true;
            wallHit = true;
            wallTopY = Math.max(wallTopY, box.maxY);
        } else if (minOverlap === overlapRight) {
            resolvedX = box.maxX + r;
            wallHitX = true;
            wallHit = true;
            wallTopY = Math.max(wallTopY, box.maxY);
        } else if (minOverlap === overlapFront) {
            resolvedZ = box.minZ - r;
            wallHitZ = true;
            wallHit = true;
            wallTopY = Math.max(wallTopY, box.maxY);
        } else if (minOverlap === overlapBack) {
            resolvedZ = box.maxZ + r;
            wallHitZ = true;
            wallHit = true;
            wallTopY = Math.max(wallTopY, box.maxY);
        }
    }

    return {
        x: resolvedX,
        y: resolvedY,
        z: resolvedZ,
        groundHit,
        ceilingHit,
        wallHit,
        wallHitX,
        wallHitZ,
        wallTopY,
    };
}

// Export collision data as simple JSON for the server
// (server needs the same boxes but can't import Three.js)
export function getCollisionBoxesData() {
    return COLLISION_BOXES.map(b => ({
        minX: b.minX, minY: b.minY, minZ: b.minZ,
        maxX: b.maxX, maxY: b.maxY, maxZ: b.maxZ,
        type: b.type,
    }));
}

// Ray-AABB intersection for jump pad placement
// Returns { t, x, y, z, nx, ny, nz } of closest hit or null
export function raycast(origin, direction, maxDist = 20) {
    let closestT = maxDist;
    let result = null;

    // Ground plane (y = 0) — not a collision box but still a valid placement surface
    if (direction.y < -1e-8) {
        const tGround = -origin.y / direction.y;
        if (tGround > 0 && tGround < closestT) {
            const hx = origin.x + direction.x * tGround;
            const hz = origin.z + direction.z * tGround;
            const half = CONFIG.ARENA_SIZE / 2;
            if (Math.abs(hx) <= half && Math.abs(hz) <= half) {
                closestT = tGround;
                result = { t: tGround, x: hx, y: 0, z: hz, nx: 0, ny: 1, nz: 0 };
            }
        }
    }

    for (const box of COLLISION_BOXES) {
        if (box.type === 'stair_step') continue;

        let tEnter = 0;
        let tExit = closestT;
        let hitNX = 0, hitNY = 0, hitNZ = 0;
        let valid = true;

        // X slab
        if (Math.abs(direction.x) < 1e-8) {
            if (origin.x < box.minX || origin.x > box.maxX) { valid = false; }
        } else {
            const t1 = (box.minX - origin.x) / direction.x;
            const t2 = (box.maxX - origin.x) / direction.x;
            const near = Math.min(t1, t2), far = Math.max(t1, t2);
            const n = (t1 < t2) ? -1 : 1;
            if (near > tEnter) { tEnter = near; hitNX = n; hitNY = 0; hitNZ = 0; }
            if (far < tExit) tExit = far;
            if (tEnter > tExit) valid = false;
        }
        if (!valid) continue;

        // Y slab
        if (Math.abs(direction.y) < 1e-8) {
            if (origin.y < box.minY || origin.y > box.maxY) { valid = false; }
        } else {
            const t1 = (box.minY - origin.y) / direction.y;
            const t2 = (box.maxY - origin.y) / direction.y;
            const near = Math.min(t1, t2), far = Math.max(t1, t2);
            const n = (t1 < t2) ? -1 : 1;
            if (near > tEnter) { tEnter = near; hitNX = 0; hitNY = n; hitNZ = 0; }
            if (far < tExit) tExit = far;
            if (tEnter > tExit) valid = false;
        }
        if (!valid) continue;

        // Z slab
        if (Math.abs(direction.z) < 1e-8) {
            if (origin.z < box.minZ || origin.z > box.maxZ) { valid = false; }
        } else {
            const t1 = (box.minZ - origin.z) / direction.z;
            const t2 = (box.maxZ - origin.z) / direction.z;
            const near = Math.min(t1, t2), far = Math.max(t1, t2);
            const n = (t1 < t2) ? -1 : 1;
            if (near > tEnter) { tEnter = near; hitNX = 0; hitNY = 0; hitNZ = n; }
            if (far < tExit) tExit = far;
            if (tEnter > tExit) valid = false;
        }
        if (!valid) continue;

        if (tEnter >= 0 && tEnter < closestT) {
            closestT = tEnter;
            result = {
                t: tEnter,
                x: origin.x + direction.x * tEnter,
                y: origin.y + direction.y * tEnter,
                z: origin.z + direction.z * tEnter,
                nx: hitNX, ny: hitNY, nz: hitNZ,
            };
        }
    }
    return result;
}
