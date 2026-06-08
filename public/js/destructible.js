import * as THREE from 'three';
import { CONFIG } from './config.js?v=5';
import { COLLISION_BOXES } from './arena.js?v=5';

// ─── Destructible Manager ───
// Handles crates, barrels (explosive + goo), and breakable walls on the client side.
// The server is authoritative — this renders destruction events received from the server.

export class DestructibleManager {
    constructor(scene, effects) {
        this.scene = scene;
        this.effects = effects;

        // Track destructible state by ID
        // Each destructible: { id, type, x, y, z, hp, alive, mesh, collisionIndex }
        this.destructibles = new Map();

        // Active goo blobs: { id, mesh, collisionIndex, expireTime }
        this.gooBlobs = [];

        this.nextGooId = 0;

        // Thrown object meshes: id → { mesh, vx, vy, vz, objType }
        this.thrownMeshes = new Map();

        // Active goo walls from thrown goo barrels
        this.gooWalls = [];
    }

    // Register a destructible from arena data
    // Called after arena is built to link meshes to collision boxes
    registerFromArena(arenaMeshes) {
        let id = 0;
        for (let i = 0; i < COLLISION_BOXES.length; i++) {
            const box = COLLISION_BOXES[i];
            if (box.destructible || box.barrelType) {
                const entry = {
                    id: id++,
                    type: box.barrelType || 'crate',
                    hp: box.barrelType === 'explosive' ? CONFIG.EXPLOSIVE_BARREL_HP :
                        box.barrelType === 'goo' ? CONFIG.GOO_BARREL_HP :
                        box.hp || 50,
                    alive: true,
                    collisionIndex: i,
                    box: box,
                    x: (box.minX + box.maxX) / 2,
                    y: (box.minY + box.maxY) / 2,
                    z: (box.minZ + box.maxZ) / 2,
                };
                this.destructibles.set(entry.id, entry);
            }
        }
    }

    // Get a destructible entry by id (for carried object type lookup)
    getDestructible(id) {
        return this.destructibles.get(id) ?? null;
    }

    // Route object events from the server
    handleObjectEvent(msg) {
        switch (msg.type) {
            case 'object_picked_up':
                this.applyPickup(msg.destId);
                break;
            case 'object_dropped':
                this.applyDrop(msg.destId);
                break;
            case 'object_thrown':
                this.applyObjectThrown(msg);
                break;
            case 'object_landed':
                this.applyObjectLanded(msg);
                break;
        }
    }

    // Hide the destructible mesh and disable its collision box (it's being carried)
    applyPickup(destId) {
        const obj = this.destructibles.get(destId);
        if (!obj) return;
        // Disable collision box
        const box = COLLISION_BOXES[obj.collisionIndex];
        if (box) {
            obj._savedBox = { minX: box.minX, minY: box.minY, minZ: box.minZ, maxX: box.maxX, maxY: box.maxY, maxZ: box.maxZ };
            box.minX = 0; box.maxX = 0;
            box.minY = 0; box.maxY = 0;
            box.minZ = 0; box.maxZ = 0;
        }
        // Hide the mesh
        this._hideMeshAt(obj.x, obj.y, obj.z, obj.type);
    }

    // Permanently remove the destructible (dropped/destroyed)
    applyDrop(destId) {
        const obj = this.destructibles.get(destId);
        if (!obj) return;
        obj.alive = false;
        // Ensure collision box is cleared
        const box = COLLISION_BOXES[obj.collisionIndex];
        if (box) {
            box.minX = 0; box.maxX = 0;
            box.minY = 0; box.maxY = 0;
            box.minZ = 0; box.maxZ = 0;
        }
        // Mesh was already hidden by applyPickup — nothing more to do
    }

    // Create a flying thrown-object mesh and track it
    applyObjectThrown(msg) {
        const { id, objType, x, y, z, vx, vy, vz } = msg;

        let geo, color;
        if (objType === 'explosive') {
            geo = new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12);
            color = 0xdd4422;
        } else if (objType === 'goo') {
            geo = new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12);
            color = 0x44aa44;
        } else {
            geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
            color = 0x8B6914;
        }

        const mat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.15,
            roughness: 0.8,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        this.scene.add(mesh);

        this.thrownMeshes.set(id, { mesh, geo, mat, vx, vy, vz, objType });
    }

    // Handle a thrown object landing
    applyObjectLanded(msg) {
        const { id, action, x, y, z, nx, ny, nz } = msg;

        // Remove thrown mesh
        const entry = this.thrownMeshes.get(id);
        if (entry) {
            this.scene.remove(entry.mesh);
            entry.geo.dispose();
            entry.mat.dispose();
            this.thrownMeshes.delete(id);
        }

        if (action === 'explode') {
            // Explosion VFX at x,y,z (reuse logic from _explodeBarrel but without barrel-specific state)
            this._explodeAt(x, y, z);
        } else if (action === 'goo_wall') {
            this._spawnGooWall(x, y, z, nx ?? 0, ny ?? 1, nz ?? 0);
        } else if (action === 'destroy') {
            // Spawn debris
            const pos = new THREE.Vector3(x, y, z);
            this._spawnDebris(pos, 0x8B6914, 8);
        }
    }

    // Simulate thrown object physics on the client for smooth visuals
    updateThrownObjects(dt) {
        const GRAVITY = 18.0;
        for (const [id, entry] of this.thrownMeshes) {
            entry.vy -= GRAVITY * dt;
            entry.mesh.position.x += entry.vx * dt;
            entry.mesh.position.y += entry.vy * dt;
            entry.mesh.position.z += entry.vz * dt;
            // Slow spin for visual flair
            entry.mesh.rotation.x += dt * 3;
            entry.mesh.rotation.z += dt * 2;
        }
    }

    _explodeAt(x, y, z) {
        const pos = new THREE.Vector3(x, y + 0.5, z);

        const flashGeo = new THREE.SphereGeometry(0.8, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 1.0 });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.copy(pos);
        this.scene.add(flash);

        const ringGeo = new THREE.RingGeometry(0.5, 1.0, 16);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);

        const RADIUS = 5.0; // CONFIG.EXPLOSIVE_RADIUS equivalent
        let timer = 0;
        const duration = 0.5;
        const animate = () => {
            timer += 1 / 60;
            const t = timer / duration;
            flash.scale.setScalar(1 + t * 4);
            flashMat.opacity = Math.max(0, 1 - t * 2);
            ring.scale.setScalar(1 + t * RADIUS * 2);
            ringMat.opacity = Math.max(0, 0.6 - t * 1.5);
            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.scene.remove(flash);
                this.scene.remove(ring);
                flashGeo.dispose(); flashMat.dispose();
                ringGeo.dispose(); ringMat.dispose();
            }
        };
        animate();

        this._spawnDebris(pos, 0xff4400, 16);
        this._spawnDebris(pos, 0xffaa00, 10);
        this._spawnDebris(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x444444, 8);

        if (this.effects) {
            const dist = pos.distanceTo(this.effects.camera.position);
            const shakeIntensity = Math.max(0, 1 - dist / (RADIUS * 3));
            if (shakeIntensity > 0) {
                this.effects.triggerScreenShake(shakeIntensity * 0.8, 0.4);
            }
        }
    }

    _spawnGooWall(x, y, z, nx, ny, nz) {
        // Wall: player height (1.8m) tall, 3× player width (2.4m) wide, 0.5m deep
        const H = CONFIG.PLAYER_HEIGHT;           // 1.8
        const W = 3 * CONFIG.PLAYER_RADIUS * 2;   // 2.4
        const D = 0.5;

        let wallW, wallH, wallD, posX, posY, posZ;
        let minX, maxX, minY, maxY, minZ, maxZ;

        if (Math.abs(ny) > 0.7) {
            // Floor hit — wall stands up along Z
            wallW = W; wallH = H; wallD = D;
            posX = x; posZ = z; posY = y + H / 2;
            minX = x - W/2; maxX = x + W/2;
            minY = y;        maxY = y + H;
            minZ = z - D/2;  maxZ = z + D/2;
        } else if (Math.abs(nx) > Math.abs(nz)) {
            // X-axis wall hit — wall spans Z
            wallW = D; wallH = H; wallD = W;
            posX = x; posZ = z; posY = y;
            minX = x - D/2;  maxX = x + D/2;
            minY = y - H/2;  maxY = y + H/2;
            minZ = z - W/2;  maxZ = z + W/2;
        } else {
            // Z-axis wall hit — wall spans X
            wallW = W; wallH = H; wallD = D;
            posX = x; posZ = z; posY = y;
            minX = x - W/2;  maxX = x + W/2;
            minY = y - H/2;  maxY = y + H/2;
            minZ = z - D/2;  maxZ = z + D/2;
        }

        const geo = new THREE.BoxGeometry(wallW, wallH, wallD);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x88dd44,
            emissive: 0x336611,
            emissiveIntensity: 0.3,
            roughness: 0.8,
            transparent: true,
            opacity: 0.9,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(posX, posY, posZ);
        this.scene.add(mesh);

        const collisionIndex = COLLISION_BOXES.length;
        COLLISION_BOXES.push({ minX, minY, minZ, maxX, maxY, maxZ, type: 'goo_wall' });

        const expireTime = performance.now() / 1000 + 30;
        this.gooWalls.push({ mesh, geo, mat, collisionIndex, expireTime });
    }

    // Apply server destruction event
    applyDestruction(event) {
        switch (event.action) {
            case 'destroy':
                this._destroyObject(event.id, event);
                break;
            case 'explode':
                this._explodeBarrel(event.id, event);
                break;
            case 'goo':
                this._spawnGoo(event.x, event.y, event.z);
                break;
        }
    }

    _destroyObject(id, event) {
        const obj = this.destructibles.get(id);
        if (!obj || !obj.alive) return;

        obj.alive = false;

        // Remove collision box (set to degenerate so it's skipped)
        const box = COLLISION_BOXES[obj.collisionIndex];
        if (box) {
            box.minX = 0; box.maxX = 0;
            box.minY = 0; box.maxY = 0;
            box.minZ = 0; box.maxZ = 0;
        }

        // Find and hide the mesh in the scene
        this._removeMeshAt(obj.x, obj.y, obj.z, obj.type);

        // Spawn debris particles
        const pos = new THREE.Vector3(obj.x, obj.y, obj.z);
        const color = obj.type === 'crate' ? 0x8B6914 : 0x888888;
        this._spawnDebris(pos, color, 12);
    }

    _explodeBarrel(id, event) {
        const obj = this.destructibles.get(id);
        if (!obj || !obj.alive) return;

        obj.alive = false;

        // Remove collision
        const box = COLLISION_BOXES[obj.collisionIndex];
        if (box) {
            box.minX = 0; box.maxX = 0;
            box.minY = 0; box.maxY = 0;
            box.minZ = 0; box.maxZ = 0;
        }

        this._removeMeshAt(obj.x, obj.y, obj.z, 'barrel');

        // Explosion VFX
        const pos = new THREE.Vector3(obj.x, obj.y + 0.5, obj.z);

        // Big flash sphere
        const flashGeo = new THREE.SphereGeometry(0.8, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({
            color: 0xff8800,
            transparent: true,
            opacity: 1.0,
        });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.copy(pos);
        this.scene.add(flash);

        // Expanding shockwave ring
        const ringGeo = new THREE.RingGeometry(0.5, 1.0, 16);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffaa44,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);

        // Animate flash + ring
        let timer = 0;
        const duration = 0.5;
        const animate = () => {
            timer += 1 / 60;
            const t = timer / duration;

            flash.scale.setScalar(1 + t * 4);
            flashMat.opacity = Math.max(0, 1 - t * 2);

            ring.scale.setScalar(1 + t * CONFIG.EXPLOSIVE_RADIUS * 2);
            ringMat.opacity = Math.max(0, 0.6 - t * 1.5);

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                this.scene.remove(flash);
                this.scene.remove(ring);
                flashGeo.dispose(); flashMat.dispose();
                ringGeo.dispose(); ringMat.dispose();
            }
        };
        animate();

        // Debris particles (lots, fiery)
        this._spawnDebris(pos, 0xff4400, 20);
        this._spawnDebris(pos, 0xffaa00, 15);
        this._spawnDebris(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x444444, 10); // smoke-colored

        // Screen shake if effects available
        if (this.effects) {
            const dist = pos.distanceTo(this.effects.camera.position);
            const shakeIntensity = Math.max(0, 1 - dist / (CONFIG.EXPLOSIVE_RADIUS * 3));
            if (shakeIntensity > 0) {
                this.effects.triggerScreenShake(shakeIntensity * 0.8, 0.4);
            }
        }
    }

    _spawnGoo(x, y, z) {
        const gooId = this.nextGooId++;
        const height = CONFIG.GOO_HEIGHT;
        const radius = CONFIG.GOO_RADIUS;

        // Goo blob mesh — irregular-looking sphere
        const geo = new THREE.SphereGeometry(radius, 8, 6);
        // Distort vertices for organic look
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const px = positions.getX(i);
            const py = positions.getY(i);
            const pz = positions.getZ(i);
            const noise = 0.8 + Math.random() * 0.4;
            positions.setX(i, px * noise);
            positions.setY(i, py * (height / radius) * (0.7 + Math.random() * 0.3));
            positions.setZ(i, pz * noise);
        }
        positions.needsUpdate = true;
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            color: 0x55dd88,
            roughness: 0.3,
            metalness: 0.1,
            transparent: true,
            opacity: 0.85,
            emissive: 0x115522,
            emissiveIntensity: 0.4,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y + height * 0.5, z);
        mesh.castShadow = true;
        this.scene.add(mesh);

        // Add collision box for the goo (climbable/standable)
        const collisionIndex = COLLISION_BOXES.length;
        COLLISION_BOXES.push({
            minX: x - radius,
            minY: y,
            minZ: z - radius,
            maxX: x + radius,
            maxY: y + height,
            maxZ: z + radius,
            type: 'goo',
        });

        this.gooBlobs.push({
            id: gooId,
            mesh,
            material: mat,
            geometry: geo,
            collisionIndex,
            expireTime: performance.now() / 1000 + CONFIG.GOO_DURATION,
            x, y, z,
        });
    }

    update(dt) {
        const now = performance.now() / 1000;

        // Expire goo blobs
        for (let i = this.gooBlobs.length - 1; i >= 0; i--) {
            const goo = this.gooBlobs[i];
            const timeLeft = goo.expireTime - now;

            // Fade out in last 3 seconds
            if (timeLeft < 3) {
                goo.material.opacity = Math.max(0, (timeLeft / 3) * 0.85);
            }

            if (timeLeft <= 0) {
                this.scene.remove(goo.mesh);
                goo.geometry.dispose();
                goo.material.dispose();
                // Remove collision
                const box = COLLISION_BOXES[goo.collisionIndex];
                if (box) {
                    box.minX = 0; box.maxX = 0;
                    box.minY = 0; box.maxY = 0;
                    box.minZ = 0; box.maxZ = 0;
                }
                this.gooBlobs.splice(i, 1);
            }
        }

        // Expire goo walls (from thrown goo barrels)
        for (let i = this.gooWalls.length - 1; i >= 0; i--) {
            const wall = this.gooWalls[i];
            const timeLeft = wall.expireTime - now;
            if (timeLeft < 3) {
                wall.mat.opacity = Math.max(0, (timeLeft / 3) * 0.9);
            }
            if (timeLeft <= 0) {
                this.scene.remove(wall.mesh);
                wall.geo.dispose();
                wall.mat.dispose();
                const box = COLLISION_BOXES[wall.collisionIndex];
                if (box) {
                    box.minX = 0; box.maxX = 0;
                    box.minY = 0; box.maxY = 0;
                    box.minZ = 0; box.maxZ = 0;
                }
                this.gooWalls.splice(i, 1);
            }
        }

        // Tick thrown object visuals
        this.updateThrownObjects(dt);
    }

    // Hide (make invisible) the mesh at a position — used for pickup, mesh stays in scene
    _hideMeshAt(x, y, z, type) {
        const threshold = 1.0;
        for (let i = this.scene.children.length - 1; i >= 0; i--) {
            const child = this.scene.children[i];
            if (!child.isMesh) continue;
            const dx = child.position.x - x;
            const dy = child.position.y - y;
            const dz = child.position.z - z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < threshold) {
                if (type === 'crate' && child.userData.destructible) {
                    child.visible = false;
                    return;
                }
                if ((type === 'explosive' || type === 'goo') && child.userData.barrel) {
                    child.visible = false;
                    return;
                }
            }
        }
    }

    // Remove the Three.js mesh at a given position
    _removeMeshAt(x, y, z, type) {
        const threshold = 1.0;
        for (let i = this.scene.children.length - 1; i >= 0; i--) {
            const child = this.scene.children[i];
            if (!child.isMesh) continue;
            const dx = child.position.x - x;
            const dy = child.position.y - y;
            const dz = child.position.z - z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) < threshold) {
                // Match by type hint
                if (type === 'crate' && child.userData.destructible) {
                    this.scene.remove(child);
                    return;
                }
                if (type === 'barrel' && child.userData.barrel) {
                    this.scene.remove(child);
                    return;
                }
            }
        }
    }

    _spawnDebris(position, color, count) {
        if (!this.effects) return;
        // Use the effects particle system
        for (let i = 0; i < count; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1,
            });
            const size = 0.05 + Math.random() * 0.1;
            const geo = new THREE.BoxGeometry(size, size, size);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);
            mesh.position.x += (Math.random() - 0.5) * 0.5;
            mesh.position.z += (Math.random() - 0.5) * 0.5;
            this.scene.add(mesh);

            const speed = 3 + Math.random() * 5;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.5;

            this.effects.particles.push({
                mesh,
                material: mat,
                vx: Math.cos(theta) * Math.cos(phi) * speed,
                vy: Math.sin(phi) * speed + 3,
                vz: Math.sin(theta) * Math.cos(phi) * speed,
                lifetime: 0.6 + Math.random() * 0.6,
                maxLifetime: 1.2,
                gravity: 14,
            });
        }
    }
}
