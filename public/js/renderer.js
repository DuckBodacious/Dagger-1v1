import * as THREE from 'three';
import { CONFIG } from './config.js?v=6';
import { buildArena } from './arena.js?v=6';

export class GameRenderer {
    constructor(canvas) {
        this.canvas = canvas;

        // ─── Scene ───
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);
        // Fog adds shader cost — skip in low quality mode (set after renderer init)
        this._pendingFog = true;

        // ─── Camera ───
        this.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 200);

        // ─── Quality tier ───
        // ?lowq in URL forces low quality (useful when iGPU is active)
        const params = new URLSearchParams(window.location.search);
        this.lowQuality = params.has('lowq');

        // ─── Renderer ───
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: !this.lowQuality,
            powerPreference: 'high-performance',
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // Low quality: render at 1× pixel ratio (no supersampling)
        this.renderer.setPixelRatio(this.lowQuality ? 1 : Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = !this.lowQuality;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        if (this.lowQuality) {
            console.log('[Renderer] Low quality mode active (iGPU fallback)');
        } else {
            this.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.018);
        }

        // ─── Lighting ───
        // Ambient
        const ambient = new THREE.AmbientLight(0x404060, 0.6);
        this.scene.add(ambient);

        // Directional (sun)
        this.sunLight = new THREE.DirectionalLight(0xffe0b0, 1.2);
        this.sunLight.position.set(20, 30, 10);
        this.sunLight.castShadow = !this.lowQuality;
        this.sunLight.shadow.mapSize.set(this.lowQuality ? 512 : 2048, this.lowQuality ? 512 : 2048);
        this.sunLight.shadow.camera.left = -25;
        this.sunLight.shadow.camera.right = 25;
        this.sunLight.shadow.camera.top = 25;
        this.sunLight.shadow.camera.bottom = -25;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 60;
        this.scene.add(this.sunLight);

        // Hemisphere light for sky/ground bounce
        const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362d1b, 0.3);
        this.scene.add(hemi);

        // ─── Ground + Arena ───
        this.createGround();
        this.arenaData = buildArena(this.scene);

        // ─── Player meshes ───
        this.playerMeshes = new Map();  // playerId → THREE.Group
        this.playerColors = new Map();  // playerId → hex color string

        // ─── Head bob state ───
        this.headBobPhase = 0;
        this.headBobIntensity = 0;

        // ─── Respawn fade ───
        this.respawnFadeTimer = 0;
        this.respawnFadeDuration = 0.8;

        // ─── Ambient dust particles (skip in low quality mode) ───
        if (!this.lowQuality) this._createDustParticles();

        // ─── Resize handler ───
        window.addEventListener('resize', () => this.onResize());
    }

    createGround() {
        const size = CONFIG.ARENA_SIZE;

        // Ground plane with grid texture
        const groundGeo = new THREE.PlaneGeometry(size, size);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x3a3a3a,
            roughness: 0.9,
            metalness: 0.1,
        });
        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        // Grid lines for spatial reference
        const gridHelper = new THREE.GridHelper(size, 40, 0x555555, 0x333333);
        gridHelper.position.y = 0.01;
        this.scene.add(gridHelper);

        // Arena boundary walls (transparent, just for visual reference)
        const wallHeight = 4;
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x4444aa,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
        });
        const half = size / 2;
        const wallPositions = [
            { x: 0, z: -half, ry: 0 },
            { x: 0, z: half, ry: 0 },
            { x: -half, z: 0, ry: Math.PI / 2 },
            { x: half, z: 0, ry: Math.PI / 2 },
        ];
        for (const wp of wallPositions) {
            const wallGeo = new THREE.PlaneGeometry(size, wallHeight);
            const wall = new THREE.Mesh(wallGeo, wallMat);
            wall.position.set(wp.x, wallHeight / 2, wp.z);
            wall.rotation.y = wp.ry;
            this.scene.add(wall);
        }
    }

    // Set chosen color for a player (from lobby state); rebuilds mesh if already created
    setPlayerColor(playerId, colorHex) {
        const prev = this.playerColors.get(playerId);
        if (prev === colorHex) return;
        this.playerColors.set(playerId, colorHex);
        // If mesh already exists, update its material
        const group = this.playerMeshes.get(playerId);
        if (group) {
            const color = new THREE.Color(colorHex);
            const body = group.getObjectByName('body');
            const head = group.getObjectByName('head');
            if (body) body.material.color.set(color);
            if (head) { head.material.emissive.set(color); }
        }
    }

    _playerColor(playerId, isLocalPlayer) {
        const stored = this.playerColors.get(playerId);
        if (stored) return new THREE.Color(stored);
        // Fallback: blue for local, deterministic palette for remotes
        const PALETTE = [0x3b82f6,0xef4444,0x22c55e,0xf59e0b,0xa855f7,0xec4899,0x14b8a6,0xf97316];
        if (isLocalPlayer) return new THREE.Color(PALETTE[0]);
        let hash = 0;
        for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
        return new THREE.Color(PALETTE[1 + (hash % (PALETTE.length - 1))]);
    }

    // Create or get the mesh group for a player
    getPlayerMesh(playerId, isLocalPlayer) {
        if (this.playerMeshes.has(playerId)) {
            return this.playerMeshes.get(playerId);
        }

        const color = this._playerColor(playerId, isLocalPlayer);
        const group = new THREE.Group();

        // Capsule body
        const bodyGeo = new THREE.CapsuleGeometry(CONFIG.PLAYER_RADIUS, CONFIG.PLAYER_HEIGHT - CONFIG.PLAYER_RADIUS * 2, 8, 12);
        const bodyMat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.4,
            metalness: 0.2,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.castShadow = true;
        body.name = 'body';
        group.add(body);

        // Head indicator (small sphere on top for facing direction visibility)
        const headGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const headMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: color,
            emissiveIntensity: 0.5,
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = CONFIG.PLAYER_HEIGHT / 2 - 0.1;
        head.name = 'head';
        group.add(head);

        // Forward direction indicator (small cone)
        const indicatorGeo = new THREE.ConeGeometry(0.08, 0.3, 4);
        const indicatorMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
        indicator.rotation.x = Math.PI / 2;
        indicator.position.set(0, CONFIG.CAMERA_HEIGHT - CONFIG.PLAYER_HEIGHT / 2, -CONFIG.PLAYER_RADIUS - 0.15);
        indicator.name = 'indicator';
        group.add(indicator);

        this.scene.add(group);
        this.playerMeshes.set(playerId, group);
        return group;
    }

    // Update a remote player's visual position
    updatePlayerMesh(playerId, state, isLocalPlayer) {
        const mesh = this.getPlayerMesh(playerId, isLocalPlayer);

        if (isLocalPlayer) {
            // Hide own mesh (first person), but still keep it for shadow
            mesh.visible = false;
            return;
        }

        mesh.visible = state.alive;
        if (!state.alive) return;

        mesh.position.set(state.x, state.y, state.z);
        mesh.rotation.y = state.yaw;

        // Update body scale for crouching
        const body = mesh.getObjectByName('body');
        if (body) {
            const targetScale = state.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / CONFIG.PLAYER_HEIGHT : 1;
            body.scale.y = THREE.MathUtils.lerp(body.scale.y, targetScale, 0.3);
        }
    }

    removePlayerMesh(playerId) {
        const mesh = this.playerMeshes.get(playerId);
        if (mesh) {
            this.scene.remove(mesh);
            this.playerMeshes.delete(playerId);
        }
    }

    // Flash a remote player's mesh white when hit
    flashPlayerHit(playerId) {
        const group = this.playerMeshes.get(playerId);
        if (!group) return;
        const body = group.getObjectByName('body');
        if (!body) return;

        const origColor = body.material.color.getHex();
        body.material.emissive.setHex(0xffffff);
        body.material.emissiveIntensity = 1.0;

        let timer = 0;
        const flashDuration = 0.15;
        const decay = () => {
            timer += 1 / 60;
            const t = timer / flashDuration;
            body.material.emissiveIntensity = Math.max(0, 1 - t) * 0.8;
            if (t < 1) {
                requestAnimationFrame(decay);
            } else {
                body.material.emissive.setHex(0x000000);
                body.material.emissiveIntensity = 0;
            }
        };
        requestAnimationFrame(decay);
    }

    // Trigger respawn fade-in
    triggerRespawnFade() {
        this.respawnFadeTimer = this.respawnFadeDuration;
    }

    // Get respawn fade opacity for HUD overlay (0 = invisible, 1 = fully opaque)
    getRespawnFadeOpacity(dt) {
        if (this.respawnFadeTimer > 0) {
            this.respawnFadeTimer -= dt;
            return Math.max(0, this.respawnFadeTimer / this.respawnFadeDuration);
        }
        return 0;
    }

    // Update camera from local player state (with head bob)
    updateCamera(playerState, dt = 1 / 60) {
        const eyeY = playerState.getEyeY();
        let bobX = 0, bobY = 0;

        // Head bob when grounded and moving
        const speed = Math.sqrt(playerState.vx * playerState.vx + playerState.vz * playerState.vz);
        const targetIntensity = (playerState.grounded && playerState.alive && !playerState.sliding && !playerState.dashing && speed > 1.5)
            ? Math.min(1, speed / CONFIG.SPRINT_SPEED) : 0;

        this.headBobIntensity += (targetIntensity - this.headBobIntensity) * Math.min(1, dt * 10);

        if (this.headBobIntensity > 0.01) {
            const bobSpeed = speed > 5 ? 12 : 9; // faster bob when sprinting
            this.headBobPhase += dt * bobSpeed;
            bobY = Math.sin(this.headBobPhase) * 0.025 * this.headBobIntensity;
            bobX = Math.cos(this.headBobPhase * 0.5) * 0.012 * this.headBobIntensity;
        } else {
            this.headBobPhase = 0;
        }

        this.camera.position.set(playerState.x + bobX, eyeY + bobY, playerState.z);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = playerState.yaw;
        this.camera.rotation.x = playerState.pitch;
        // Subtle roll during head bob for natural feel
        this.camera.rotation.z = Math.sin(this.headBobPhase * 0.5) * 0.003 * this.headBobIntensity;
    }

    render(dt = 1 / 60) {
        this.updateDust(dt);
        this.renderer.render(this.scene, this.camera);
        this._trackFps(dt);
    }

    _trackFps(dt) {
        if (!this._fpsHistory) {
            this._fpsHistory = [];
            this._fpsFrames = 0;
            this._fpsBadFrames = 0;
            this._fpsWarned = false;
            this._fpsCheckDone = false;
        }
        if (this._fpsCheckDone) return;

        this._fpsFrames++;
        const fps = 1 / dt;
        this._fpsHistory.push(fps);

        // After 120 frames (~2s), decide quality
        if (this._fpsHistory.length >= 120) {
            this._fpsCheckDone = true;
            const avg = this._fpsHistory.reduce((a, b) => a + b, 0) / this._fpsHistory.length;
            if (avg < 45 && !this.lowQuality) {
                this._showLowFpsHint(avg);
            }
        }
    }

    _showLowFpsHint(avg) {
        const hint = document.createElement('div');
        hint.style.cssText = `
            position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
            background:rgba(0,0,0,0.85); color:#fff; padding:18px 26px;
            border-radius:10px; font-family:monospace; font-size:14px;
            text-align:center; z-index:9999; border:1px solid #555;
            max-width:380px; line-height:1.7;
        `;
        hint.innerHTML = `
            <b style="color:#f87171">⚠ Low FPS detected (${avg.toFixed(0)} avg)</b><br>
            Your browser may be using the <b>integrated GPU</b>.<br><br>
            <b>Quick fix:</b> Add <code style="background:#333;padding:2px 6px;border-radius:3px">?lowq</code> to the URL:<br>
            <code style="background:#333;padding:2px 6px;border-radius:3px">http://localhost:3000?lowq</code><br><br>
            <b>Full fix:</b> In <b>NVIDIA Control Panel</b> → Manage 3D Settings → Program Settings → add your browser → set <i>High-performance NVIDIA processor</i>.<br><br>
            <button id="lowq-dismiss" style="margin-top:8px;padding:6px 18px;background:#3b82f6;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:13px">Dismiss</button>
            <button id="lowq-reload" style="margin-top:8px;margin-left:8px;padding:6px 18px;background:#10b981;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:13px">Switch to Low Quality</button>
        `;
        document.body.appendChild(hint);
        document.getElementById('lowq-dismiss').onclick = () => hint.remove();
        document.getElementById('lowq-reload').onclick = () => {
            const url = new URL(window.location.href);
            url.searchParams.set('lowq', '');
            window.location.href = url.toString();
        };
    }

    _createDustParticles() {
        const count = 300;
        const spread = CONFIG.ARENA_SIZE;
        const positions = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * spread;
            positions[i * 3 + 1] = Math.random() * 15;
            positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: 0xaaaaaa,
            size: 0.06,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.dustParticles = new THREE.Points(geo, mat);
        this.dustParticles.frustumCulled = false;
        this.scene.add(this.dustParticles);
        this._dustVelocities = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            this._dustVelocities[i * 3] = (Math.random() - 0.5) * 0.3;
            this._dustVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
            this._dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        }
    }

    updateDust(dt) {
        if (!this.dustParticles) return;
        const positions = this.dustParticles.geometry.attributes.position.array;
        const vel = this._dustVelocities;
        const half = CONFIG.ARENA_SIZE / 2;

        for (let i = 0; i < positions.length / 3; i++) {
            positions[i * 3] += vel[i * 3] * dt;
            positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
            positions[i * 3 + 2] += vel[i * 3 + 2] * dt;

            // Wrap around arena bounds
            if (positions[i * 3] > half) positions[i * 3] = -half;
            if (positions[i * 3] < -half) positions[i * 3] = half;
            if (positions[i * 3 + 1] > 15) positions[i * 3 + 1] = 0;
            if (positions[i * 3 + 1] < 0) positions[i * 3 + 1] = 15;
            if (positions[i * 3 + 2] > half) positions[i * 3 + 2] = -half;
            if (positions[i * 3 + 2] < -half) positions[i * 3 + 2] = half;
        }
        this.dustParticles.geometry.attributes.position.needsUpdate = true;
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
