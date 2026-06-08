import * as THREE from 'three';
import { CONFIG } from './config.js?v=5';

const THROW_SPEED = 14; // m/s — applied along camera direction
const THROW_UP    = 3;  // extra upward boost so level shots arc nicely
const MAX_FLIGHT  = 1.2; // seconds — gateway stops wherever it is after this

export class GatewayManager {
    constructor(scene) {
        this.scene   = scene;
        // id → { mesh, data: {id, ownerId, x, y, z}, linked }
        this.gateways = new Map();
        this._inFlight = null;  // currently thrown (animating) gateway
        this._animTime = 0;
    }

    // ── Visuals ──────────────────────────────────────────────────────────────

    /** Black cube — unlinked gateway resting on the floor */
    _buildUnlinked() {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            emissive: 0x000000,
            metalness: 0.9,
            roughness: 0.2,
        });
        const geo  = new THREE.BoxGeometry(0.45, 0.45, 0.45);
        const mesh = new THREE.Mesh(geo, mat);
        // Float just above the floor, slightly rotating for visibility
        mesh.position.y = 0.38;
        mesh.rotation.y = Math.PI / 6;
        group.add(mesh);
        return group;
    }

    /** Cyan glowing ring — linked (active) gateway */
    _buildLinked(opacity = 1.0) {
        const group = new THREE.Group();
        const transparent = opacity < 1.0;

        const frameMat = new THREE.MeshStandardMaterial({
            color: 0x00d8ff,
            emissive: 0x00b8d4,
            emissiveIntensity: 2.5,
            metalness: 0.8,
            roughness: 0.2,
            transparent,
            opacity,
        });
        const frameGeo = new THREE.TorusGeometry(0.88, 0.07, 14, 64);
        group.add(new THREE.Mesh(frameGeo, frameMat));

        // Translucent fill disc
        const discMat = new THREE.MeshStandardMaterial({
            color: 0x00cfff,
            emissive: 0x004466,
            emissiveIntensity: 1.0,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        group.add(new THREE.Mesh(new THREE.CircleGeometry(0.88, 64), discMat));

        // Inner glow ring
        const innerMat = new THREE.MeshStandardMaterial({
            color: 0x88eeff,
            emissive: 0x00aacc,
            emissiveIntensity: 3.0,
            transparent: true,
            opacity: 0.7,
        });
        group.add(new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.03, 14, 64), innerMat));

        return group;
    }

    /** Small black cube spinning through the air */
    _buildInFlightMesh() {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            emissive: 0x000000,
            metalness: 0.9,
            roughness: 0.2,
        });
        return new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat);
    }

    // ── Throw physics ─────────────────────────────────────────────────────────

    hasInFlight() { return this._inFlight !== null; }

    /**
     * Start a throw animation using the camera's full 3D direction (pitch + yaw).
     * Calls onLand(landX, landY, landZ) when the mesh either hits the floor (y≤0)
     * or the max flight time expires — whichever comes first.
     * If the flight time expires while still airborne the gateway stays mid-air.
     */
    startThrow(playerX, playerY, playerZ, dirX, dirY, dirZ, onLand) {
        if (this._inFlight) return false;

        // Launch from the player's hand (slightly ahead + above center)
        const sx = playerX + dirX * 0.6;
        const sy = playerY + 0.5;
        const sz = playerZ + dirZ * 0.6;

        const mesh = this._buildInFlightMesh();
        mesh.position.set(sx, sy, sz);
        this.scene.add(mesh);

        this._inFlight = {
            mesh,
            x: sx, y: sy, z: sz,
            vx: dirX * THROW_SPEED,
            vy: dirY * THROW_SPEED + THROW_UP, // pitch + upward boost
            vz: dirZ * THROW_SPEED,
            elapsed: 0,
            onLand,
        };
        return true;
    }

    cancelInFlight() {
        if (!this._inFlight) return;
        this.scene.remove(this._inFlight.mesh);
        this._inFlight = null;
    }

    // ── Server event handlers ────────────────────────────────────────────────

    onGatewayPlaced(data) {
        const mesh = data.linked ? this._buildLinked(1.0) : this._buildUnlinked();
        // Linked ring: center at 0.9 m above floor. Unlinked: group handles its own offset.
        if (data.linked) mesh.position.set(data.x, data.y + 0.9, data.z);
        else              mesh.position.set(data.x, data.y, data.z);
        this.scene.add(mesh);
        this.gateways.set(data.id, { mesh, data, linked: data.linked });
    }

    /** Server says first portal is now linked — swap its mesh for the glowing ring */
    onGatewayLinked(aId) {
        const entry = this.gateways.get(aId);
        if (!entry) return;
        const oldPos = entry.mesh.position.clone();
        this.scene.remove(entry.mesh);
        const mesh = this._buildLinked(1.0);
        // Entry was positioned at floor level; ring center should be 0.9 m up
        mesh.position.set(oldPos.x, entry.data.y + 0.9, oldPos.z);
        this.scene.add(mesh);
        entry.mesh   = mesh;
        entry.linked = true;
    }

    onGatewayExpired(aId, bId) {
        for (const id of [aId, bId]) {
            if (id == null) continue;
            const entry = this.gateways.get(id);
            if (entry) { this.scene.remove(entry.mesh); this.gateways.delete(id); }
        }
    }

    // ── Proximity check ───────────────────────────────────────────────────────

    isNearLinked(px, py, pz) {
        const r = CONFIG.GATEWAY_INTERACT_RADIUS;
        for (const entry of this.gateways.values()) {
            if (!entry.linked) continue;
            const dx = px - entry.data.x;
            const dy = py - entry.data.y;
            const dz = pz - entry.data.z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < r) return true;
        }
        return false;
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    update(dt) {
        this._animTime += dt;

        // ── Throw arc ──
        if (this._inFlight) {
            const inf = this._inFlight;
            inf.elapsed += dt;

            // Pure gravity — no drag (clean parabola like The Finals)
            inf.vy -= CONFIG.GRAVITY * dt;
            inf.x  += inf.vx * dt;
            inf.y  += inf.vy * dt;
            inf.z  += inf.vz * dt;

            // Clamp to arena bounds
            const half = CONFIG.ARENA_SIZE / 2;
            inf.x = Math.max(-half, Math.min(half, inf.x));
            inf.z = Math.max(-half, Math.min(half, inf.z));

            inf.mesh.position.set(inf.x, Math.max(inf.y, 0), inf.z);
            inf.mesh.rotation.y += 6 * dt;
            inf.mesh.rotation.x += 4 * dt;

            // Stop when floor is hit OR max flight time expires (whichever first).
            // If time expires while airborne the gateway stays at that height — mid-air.
            const hitFloor  = inf.y <= 0.05;
            const timeUp    = inf.elapsed >= MAX_FLIGHT;

            if (hitFloor || timeUp) {
                const landX = inf.x;
                const landY = hitFloor ? 0 : Math.max(inf.y, 0); // 0 for floor, actual y for mid-air
                const landZ = inf.z;
                const cb = inf.onLand;
                this.scene.remove(inf.mesh);
                this._inFlight = null;
                if (cb) cb(landX, landY, landZ);
            }
        }

        // ── Linked portal pulse ──
        const pulse = Math.sin(this._animTime * 2.5);
        for (const entry of this.gateways.values()) {
            if (!entry.linked || entry.mesh.children.length < 2) continue;
            const disc = entry.mesh.children[1];
            if (disc?.material) disc.material.opacity = 0.22 + pulse * 0.08;
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    clear() {
        this.cancelInFlight();
        for (const { mesh } of this.gateways.values()) this.scene.remove(mesh);
        this.gateways.clear();
    }
}
