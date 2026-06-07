import * as THREE from 'three';
import { CONFIG } from './config.js?v=3';

// Manages all visual effects: slash trails, dash trails, particles, screen shake
export class EffectsManager {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;

        this.slashTrails = [];
        this.dashTrails = [];
        this.particles = [];
        this.damageFlashes = [];

        // Screen shake state
        this.shakeIntensity = 0;
        this.shakeTimer = 0;
        this.shakeOffset = { x: 0, y: 0 };

        // Reusable geometries (shared across all instances)
        this._slashGeo = new THREE.PlaneGeometry(0.8, 0.15);
        this._particleGeo = new THREE.SphereGeometry(0.04, 4, 4);
        this._debrisGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);

        // Particle pool for performance
        this._particlePool = [];
        this._maxPoolSize = 200;

        // Dash trail material (shared)
        this._dashTrailMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    }

    update(dt) {
        this._updateSlashTrails(dt);
        this._updateDashTrails(dt);
        this._updateParticles(dt);
        this._updateScreenShake(dt);
    }

    // ─── Slash Trail (attack feedback, works for local + remote) ───
    spawnSlashTrail(position, direction, isCharged) {
        const mat = new THREE.MeshBasicMaterial({
            color: isCharged ? 0xff4444 : 0xffffff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        // Create an arc of small planes to simulate a slash
        const arcCount = 5;
        const group = new THREE.Group();
        for (let i = 0; i < arcCount; i++) {
            const plane = new THREE.Mesh(this._slashGeo, mat);
            const angle = (i / arcCount - 0.5) * Math.PI * 0.6;
            const radius = isCharged ? 1.2 : 0.8;
            plane.position.set(
                Math.sin(angle) * radius,
                Math.cos(angle) * radius * 0.3,
                -0.5
            );
            plane.rotation.z = -angle;
            group.add(plane);
        }

        group.position.copy(position);
        // Orient slash toward the direction
        if (direction instanceof THREE.Vector3 || (direction && direction.x !== undefined)) {
            const target = position.clone().add(new THREE.Vector3(direction.x, direction.y || 0, direction.z));
            group.lookAt(target);
        } else {
            group.quaternion.copy(this.camera.quaternion);
        }
        this.scene.add(group);

        this.slashTrails.push({
            mesh: group,
            material: mat,
            lifetime: 0.2,
            maxLifetime: 0.2,
        });
    }

    // ─── Elbow Effect ───
    spawnElbowEffect(position) {
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffaa44,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        const geo = new THREE.RingGeometry(0.1, 0.4, 6);
        const ring = new THREE.Mesh(geo, mat);
        ring.position.copy(position);
        ring.quaternion.copy(this.camera.quaternion);
        this.scene.add(ring);

        this.slashTrails.push({
            mesh: ring,
            material: mat,
            lifetime: 0.15,
            maxLifetime: 0.15,
        });
    }

    _updateSlashTrails(dt) {
        for (let i = this.slashTrails.length - 1; i >= 0; i--) {
            const trail = this.slashTrails[i];
            trail.lifetime -= dt;
            const t = trail.lifetime / trail.maxLifetime;
            trail.material.opacity = t * 0.8;

            // Scale up slightly as it fades
            const scale = 1 + (1 - t) * 0.5;
            trail.mesh.scale.set(scale, scale, scale);

            if (trail.lifetime <= 0) {
                this.scene.remove(trail.mesh);
                trail.material.dispose();
                this.slashTrails.splice(i, 1);
            }
        }
    }

    // ─── Dash Trail ───
    spawnDashTrail(startPos, endPos) {
        // Create a series of translucent capsules along the dash path
        const trailCount = 6;
        const trails = [];

        for (let i = 0; i < trailCount; i++) {
            const t = i / trailCount;
            const mat = this._dashTrailMat.clone();
            mat.opacity = 0.3 * (1 - t);

            const geo = new THREE.CapsuleGeometry(
                CONFIG.PLAYER_RADIUS * (1 - t * 0.3),
                (CONFIG.PLAYER_HEIGHT - CONFIG.PLAYER_RADIUS * 2) * 0.6,
                4, 6
            );
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.lerpVectors(startPos, endPos, t);
            this.scene.add(mesh);

            trails.push({
                mesh,
                material: mat,
                lifetime: CONFIG.DASH_TRAIL_DURATION * (1 - t * 0.5),
                maxLifetime: CONFIG.DASH_TRAIL_DURATION,
            });
        }

        this.dashTrails.push(...trails);
    }

    _updateDashTrails(dt) {
        for (let i = this.dashTrails.length - 1; i >= 0; i--) {
            const trail = this.dashTrails[i];
            trail.lifetime -= dt;
            const t = trail.lifetime / trail.maxLifetime;
            trail.material.opacity = t * 0.3;

            if (trail.lifetime <= 0) {
                this.scene.remove(trail.mesh);
                trail.mesh.geometry.dispose();
                trail.material.dispose();
                this.dashTrails.splice(i, 1);
            }
        }
    }

    // ─── Hit Particles ───
    spawnHitParticles(position, color = 0xff4444, count = 8) {
        for (let i = 0; i < count; i++) {
            const { mesh, material } = this._getParticleMesh(color);
            mesh.position.copy(position);
            this.scene.add(mesh);

            // Random velocity
            const speed = 2 + Math.random() * 4;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI - Math.PI / 2;

            this.particles.push({
                mesh,
                material,
                vx: Math.cos(theta) * Math.cos(phi) * speed,
                vy: Math.sin(phi) * speed + 2,
                vz: Math.sin(theta) * Math.cos(phi) * speed,
                lifetime: 0.4 + Math.random() * 0.3,
                maxLifetime: 0.7,
                gravity: 12,
            });
        }
    }

    // Blood/spark burst on backstab
    spawnBackstabParticles(position) {
        this.spawnHitParticles(position, 0xff2222, 16);
        // Extra bright flash particles
        for (let i = 0; i < 4; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffaaaa,
                transparent: true,
                opacity: 1,
            });
            const geo = new THREE.SphereGeometry(0.08, 4, 4);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);
            this.scene.add(mesh);

            const speed = 1 + Math.random() * 2;
            const theta = Math.random() * Math.PI * 2;

            this.particles.push({
                mesh,
                material: mat,
                vx: Math.cos(theta) * speed,
                vy: 3 + Math.random() * 2,
                vz: Math.sin(theta) * speed,
                lifetime: 0.5,
                maxLifetime: 0.5,
                gravity: 8,
            });
        }
    }

    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.lifetime -= dt;
            p.vy -= p.gravity * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.z += p.vz * dt;

            const t = p.lifetime / p.maxLifetime;
            p.material.opacity = t;
            p.mesh.scale.setScalar(0.5 + t * 0.5);

            if (p.lifetime <= 0) {
                this.scene.remove(p.mesh);
                // Pool for reuse instead of disposing
                if (this._particlePool.length < this._maxPoolSize) {
                    p.mesh.visible = false;
                    this._particlePool.push(p.mesh);
                } else {
                    p.material.dispose();
                }
                this.particles.splice(i, 1);
            }
        }
    }

    // Get or create a particle mesh
    _getParticleMesh(color) {
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
        if (this._particlePool.length > 0) {
            const mesh = this._particlePool.pop();
            mesh.material.dispose();
            mesh.material = mat;
            mesh.visible = true;
            mesh.scale.setScalar(1);
            return { mesh, material: mat };
        }
        const mesh = new THREE.Mesh(this._particleGeo, mat);
        return { mesh, material: mat };
    }

    // ─── Screen Shake ───
    triggerScreenShake(intensity, duration) {
        this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
        this.shakeTimer = Math.max(this.shakeTimer, duration);
    }

    _updateScreenShake(dt) {
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt;
            const t = this.shakeTimer > 0 ? 1 : 0;
            this.shakeOffset.x = (Math.random() - 0.5) * 2 * this.shakeIntensity * t;
            this.shakeOffset.y = (Math.random() - 0.5) * 2 * this.shakeIntensity * t;

            if (this.shakeTimer <= 0) {
                this.shakeIntensity = 0;
                this.shakeOffset.x = 0;
                this.shakeOffset.y = 0;
            }
        }
    }

    // Apply shake to camera (call after camera update)
    applyShakeToCamera(camera) {
        if (this.shakeTimer > 0) {
            camera.rotation.x += this.shakeOffset.x * 0.02;
            camera.rotation.y += this.shakeOffset.y * 0.02;
        }
    }
}
