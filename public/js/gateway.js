import * as THREE from 'three';
import { CONFIG } from './config.js';
import { raycast } from './arena.js';

export class GatewayManager {
    constructor(scene) {
        this.scene = scene;
        // id → { mesh, data: {id, ownerId, x, y, z}, linked }
        this.gateways = new Map();
        this._preview = this._buildPortal(false, 0.35);
        this._preview.visible = false;
        scene.add(this._preview);
        this._animTime = 0;
    }

    // ── Visual construction ──────────────────────────────────────────────────

    _buildPortal(linked, opacity = 1.0) {
        const group = new THREE.Group();
        const transparent = opacity < 1.0;

        const frameColor   = linked ? 0x00d8ff : 0x557799;
        const frameEmit    = linked ? 0x00b8d4 : 0x112233;
        const frameIntensity = linked ? 2.5 : 0.4;

        // Outer frame ring
        const frameMat = new THREE.MeshStandardMaterial({
            color: frameColor,
            emissive: frameEmit,
            emissiveIntensity: frameIntensity,
            metalness: 0.8,
            roughness: 0.2,
            transparent,
            opacity,
        });
        const frameGeo = new THREE.TorusGeometry(0.88, 0.07, 14, 64);
        const frame = new THREE.Mesh(frameGeo, frameMat);
        group.add(frame);

        if (linked) {
            // Filled portal disc
            const discMat = new THREE.MeshStandardMaterial({
                color: 0x00cfff,
                emissive: 0x004466,
                emissiveIntensity: 1.0,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const discGeo = new THREE.CircleGeometry(0.88, 64);
            const disc = new THREE.Mesh(discGeo, discMat);
            group.add(disc);

            // Inner glow ring
            const innerMat = new THREE.MeshStandardMaterial({
                color: 0x88eeff,
                emissive: 0x00aacc,
                emissiveIntensity: 3.0,
                transparent: true,
                opacity: 0.7,
            });
            const innerGeo = new THREE.TorusGeometry(0.72, 0.03, 14, 64);
            const inner = new THREE.Mesh(innerGeo, innerMat);
            group.add(inner);
        }

        // TorusGeometry default: ring lies in the XY plane (already vertical when Y=up).
        // Raise the group so the portal center is at eye height (~0.9m above base).
        group.userData.isGateway = true;
        return group;
    }

    // ── Placement targeting ──────────────────────────────────────────────────

    getPlacementTarget(camera) {
        const origin = camera.position.clone();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        return raycast(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: dir.x, y: dir.y, z: dir.z },
            20
        );
    }

    updatePreview(hit) {
        if (!hit) {
            this._preview.visible = false;
            return;
        }
        this._preview.position.set(hit.x, hit.y + 0.9, hit.z);
        this._preview.visible = true;
    }

    // ── Server event handlers ────────────────────────────────────────────────

    onGatewayPlaced(data) {
        const mesh = this._buildPortal(data.linked, 1.0);
        mesh.position.set(data.x, data.y + 0.9, data.z);
        this.scene.add(mesh);
        this.gateways.set(data.id, { mesh, data, linked: data.linked });
    }

    // Server confirmed both portals are now linked — upgrade the first one
    onGatewayLinked(aId) {
        const entry = this.gateways.get(aId);
        if (!entry) return;
        const oldPos = entry.mesh.position.clone();
        this.scene.remove(entry.mesh);
        const mesh = this._buildPortal(true, 1.0);
        mesh.position.copy(oldPos);
        this.scene.add(mesh);
        entry.mesh = mesh;
        entry.linked = true;
    }

    onGatewayExpired(aId, bId) {
        for (const id of [aId, bId]) {
            if (id === undefined) continue;
            const entry = this.gateways.get(id);
            if (entry) {
                this.scene.remove(entry.mesh);
                this.gateways.delete(id);
            }
        }
    }

    // ── Proximity check (for E-key prompt) ───────────────────────────────────

    // Returns true if player is near any linked gateway
    isNearLinked(px, pz) {
        const r = CONFIG.GATEWAY_INTERACT_RADIUS;
        for (const entry of this.gateways.values()) {
            if (!entry.linked) continue;
            const dx = px - entry.data.x;
            const dz = pz - entry.data.z;
            if (Math.sqrt(dx * dx + dz * dz) < r) return true;
        }
        return false;
    }

    // ── Per-frame animation ───────────────────────────────────────────────────

    update(dt) {
        this._animTime += dt;
        const pulse = Math.sin(this._animTime * 2.5);
        for (const entry of this.gateways.values()) {
            if (!entry.linked || entry.mesh.children.length < 2) continue;
            const disc = entry.mesh.children[1];
            if (disc?.material) disc.material.opacity = 0.22 + pulse * 0.08;
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    clear() {
        for (const { mesh } of this.gateways.values()) this.scene.remove(mesh);
        this.gateways.clear();
        this._preview.visible = false;
    }
}
