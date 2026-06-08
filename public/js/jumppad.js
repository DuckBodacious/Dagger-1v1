import * as THREE from 'three';
import { CONFIG } from './config.js?v=6';
import { raycast } from './arena.js?v=6';

const UP = new THREE.Vector3(0, 1, 0);

export class JumpPadManager {
    constructor(scene) {
        this.scene = scene;
        this.pads = new Map(); // id → { mesh, data }
        this._preview = this._buildPadMesh(0x333333, 0.45);
        this._preview.visible = false;
        scene.add(this._preview);
    }

    _buildPadMesh(color, opacity = 1.0) {
        const group = new THREE.Group();
        const transparent = opacity < 1;

        // Orange base disc
        const baseMat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.4,
            metalness: 0.3,
            roughness: 0.5,
            transparent,
            opacity,
        });
        const baseGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.07, 32);
        const base = new THREE.Mesh(baseGeo, baseMat);
        group.add(base);

        // Dark blue ring material
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0x1a3a8f,
            emissive: 0x1a3a8f,
            emissiveIntensity: 0.7,
            metalness: 0.5,
            roughness: 0.3,
            transparent,
            opacity,
        });

        // Outer ring — near the edge of the base
        // TorusGeometry(radius, tubeRadius, radialSegments, tubularSegments)
        const outerRingGeo = new THREE.TorusGeometry(0.38, 0.055, 12, 48);
        const outerRing = new THREE.Mesh(outerRingGeo, ringMat);
        outerRing.rotation.x = Math.PI / 2; // lie flat on the disc
        outerRing.position.set(0, 0.06, 0);
        group.add(outerRing);

        // Inner ring — centered, smaller
        const innerRingGeo = new THREE.TorusGeometry(0.18, 0.045, 12, 48);
        const innerRing = new THREE.Mesh(innerRingGeo, ringMat);
        innerRing.rotation.x = Math.PI / 2;
        innerRing.position.set(0, 0.06, 0);
        group.add(innerRing);

        return group;
    }

    _orientMesh(mesh, nx, ny, nz) {
        const normal = new THREE.Vector3(nx, ny, nz).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
        mesh.quaternion.copy(quat);
    }

    // Returns raycast hit for pad placement from the camera
    getPlacementTarget(camera) {
        const origin = camera.position.clone();
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        return raycast(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: direction.x, y: direction.y, z: direction.z },
            20
        );
    }

    // Show/hide the placement preview ghost
    updatePreview(hit) {
        if (!hit) {
            this._preview.visible = false;
            return;
        }
        const offset = 0.05;
        this._preview.position.set(
            hit.x + hit.nx * offset,
            hit.y + hit.ny * offset,
            hit.z + hit.nz * offset
        );
        this._orientMesh(this._preview, hit.nx, hit.ny, hit.nz);
        this._preview.visible = true;
    }

    // Called when server confirms a pad was placed
    onPadPlaced(data) {
        // Remove existing mesh for this owner if any
        for (const [id, entry] of this.pads) {
            if (entry.data.ownerId === data.ownerId) {
                this.scene.remove(entry.mesh);
                this.pads.delete(id);
                break;
            }
        }

        const mesh = this._buildPadMesh(0x333333, 1.0);
        mesh.position.set(
            data.x + data.nx * 0.05,
            data.y + data.ny * 0.05,
            data.z + data.nz * 0.05
        );
        this._orientMesh(mesh, data.nx, data.ny, data.nz);
        this.scene.add(mesh);
        this.pads.set(data.id, { mesh, data });
    }

    // Called when server removes a pad
    onPadRemoved(id) {
        const entry = this.pads.get(id);
        if (entry) {
            this.scene.remove(entry.mesh);
            this.pads.delete(id);
        }
    }

    // Brief bounce animation when triggered
    onPadTriggered(id) {
        const entry = this.pads.get(id);
        if (!entry) return;
        const mesh = entry.mesh;
        const startScale = mesh.scale.clone();
        let t = 0;
        const pulse = () => {
            t += 0.05;
            const s = 1 + Math.sin(t * Math.PI) * 0.3;
            mesh.scale.setScalar(s);
            if (t < 1) requestAnimationFrame(pulse);
            else mesh.scale.copy(startScale);
        };
        requestAnimationFrame(pulse);
    }

    dispose() {
        for (const { mesh } of this.pads.values()) {
            this.scene.remove(mesh);
        }
        this.pads.clear();
        this.scene.remove(this._preview);
    }
}
