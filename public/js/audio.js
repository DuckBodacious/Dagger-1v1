import { CONFIG } from './config.js?v=4';

// Procedural audio engine using Web Audio API with 3D spatial positioning
export class AudioManager {
    constructor() {
        this.ctx = null;           // AudioContext, created on first user gesture
        this.listener = null;      // AudioListener (camera position)
        this.masterGain = null;
        this.sfxGain = null;
        this.initialized = false;

        // Footstep timing
        this.footstepTimer = 0;
        this.footstepAlt = false;  // alternate L/R foot

        // Slide loop
        this.slideOsc = null;
        this.slideGain = null;
        this.isSliding = false;

        // Sound buffers (generated once)
        this.buffers = {};
    }

    // Must be called from a user gesture (click/keypress)
    init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.listener = this.ctx.listener;

            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.6;
            this.masterGain.connect(this.ctx.destination);

            this.sfxGain = this.ctx.createGain();
            this.sfxGain.gain.value = 1.0;
            this.sfxGain.connect(this.masterGain);

            this._generateBuffers();
            this.initialized = true;
            console.log('[Audio] Initialized');

            // Load custom backstab sound
            fetch('/assets/sounds/backstab.mp3')
                .then(r => r.arrayBuffer())
                .then(ab => this.ctx.decodeAudioData(ab))
                .then(decoded => { this.buffers.backstab = decoded; })
                .catch(e => console.warn('[Audio] Backstab MP3 load failed:', e));

            // Load jump pad sound
            fetch('/assets/sounds/jumppad.mp3')
                .then(r => r.arrayBuffer())
                .then(ab => this.ctx.decodeAudioData(ab))
                .then(decoded => { this.buffers.jumppad = decoded; })
                .catch(e => console.warn('[Audio] Jumppad MP3 load failed:', e));
        } catch (e) {
            console.warn('[Audio] Failed to initialize:', e);
        }
    }

    // Call every frame to update listener position (camera)
    updateListener(camera) {
        if (!this.initialized) return;
        const l = this.listener;

        // Ensure the camera world matrix is current
        camera.updateMatrixWorld(true);
        const m = camera.matrixWorld.elements;

        // Forward vector: -Z column of world matrix
        const fx = -m[8], fy = -m[9], fz = -m[10];
        // Up vector: +Y column of world matrix
        const ux = m[4], uy = m[5], uz = m[6];

        if (l.positionX !== undefined) {
            // Modern AudioListener API
            l.positionX.value = camera.position.x;
            l.positionY.value = camera.position.y;
            l.positionZ.value = camera.position.z;
            l.forwardX.value = fx;
            l.forwardY.value = fy;
            l.forwardZ.value = fz;
            l.upX.value = ux;
            l.upY.value = uy;
            l.upZ.value = uz;
        } else {
            // Legacy API (Safari / older browsers)
            l.setPosition(camera.position.x, camera.position.y, camera.position.z);
            l.setOrientation(fx, fy, fz, ux, uy, uz);
        }
    }

    // ─── Procedural Buffer Generation ───
    _generateBuffers() {
        const sr = this.ctx.sampleRate;

        // Noise buffer (shared, 1 second)
        this.buffers.noise = this._createNoiseBuffer(sr);

        // Footstep: short filtered noise burst
        this.buffers.footstep = this._createFootstepBuffer(sr);

        // Dagger swing: short whoosh
        this.buffers.swing = this._createSwingBuffer(sr, 0.15);

        // Heavy swing (charged): longer, deeper whoosh
        this.buffers.heavySwing = this._createSwingBuffer(sr, 0.25);

        // Hit impact: low thud + noise
        this.buffers.hit = this._createHitBuffer(sr, 0.12);

        // Backstab impact: longer, deeper, metallic
        this.buffers.backstab = this._createBackstabBuffer(sr);

        // Elbow: blunt impact
        this.buffers.elbow = this._createElbowBuffer(sr);

        // Dash: fast whoosh
        this.buffers.dash = this._createDashBuffer(sr);

        // Jump: light upward pop
        this.buffers.jump = this._createJumpBuffer(sr);

        // Land: ground impact
        this.buffers.land = this._createLandBuffer(sr);

        // Explosion: big boom
        this.buffers.explosion = this._createExplosionBuffer(sr);

        // Goo splat: wet noise
        this.buffers.goo = this._createGooBuffer(sr);

        // Kill confirm: sharp ding
        this.buffers.killConfirm = this._createKillConfirmBuffer(sr);

        // Death: low descending tone
        this.buffers.death = this._createDeathBuffer(sr);
    }

    _createNoiseBuffer(sr) {
        const buf = this.ctx.createBuffer(1, sr, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < sr; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buf;
    }

    _createFootstepBuffer(sr) {
        const len = Math.floor(sr * 0.06);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            // Sharp noise burst with fast decay
            const env = Math.exp(-t * 30);
            data[i] = (Math.random() * 2 - 1) * env * 0.5;
            // Add a low thump
            data[i] += Math.sin(t * Math.PI * 2 * 80) * env * 0.4;
        }
        return buf;
    }

    _createSwingBuffer(sr, duration) {
        const len = Math.floor(sr * duration);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            // Rising then falling pitch whoosh
            const freq = 200 + Math.sin(t * Math.PI) * 600;
            const env = Math.sin(t * Math.PI) * 0.3;
            data[i] = (Math.random() * 2 - 1) * env;
            // Add tonal component for metallic feel
            data[i] += Math.sin(i / sr * Math.PI * 2 * freq) * env * 0.2;
        }
        return buf;
    }

    _createHitBuffer(sr, duration) {
        const len = Math.floor(sr * duration);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 20);
            // Noise + low thump
            data[i] = (Math.random() * 2 - 1) * env * 0.4;
            data[i] += Math.sin(t * Math.PI * 2 * 120) * env * 0.6;
        }
        return buf;
    }

    _createBackstabBuffer(sr) {
        const len = Math.floor(sr * 0.3);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 8);
            // Deep impact
            data[i] = Math.sin(t * Math.PI * 2 * 60) * env * 0.7;
            // Metallic ring
            data[i] += Math.sin(t * Math.PI * 2 * 1200) * env * 0.15;
            data[i] += Math.sin(t * Math.PI * 2 * 2400) * env * 0.08;
            // Noise crunch
            data[i] += (Math.random() * 2 - 1) * env * 0.3;
        }
        return buf;
    }

    _createElbowBuffer(sr) {
        const len = Math.floor(sr * 0.1);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 25);
            // Blunt meaty thud
            data[i] = Math.sin(t * Math.PI * 2 * 90) * env * 0.6;
            data[i] += (Math.random() * 2 - 1) * env * 0.3;
        }
        return buf;
    }

    _createDashBuffer(sr) {
        const len = Math.floor(sr * 0.3);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            // Fast whoosh — noise with rising then falling filter feel
            const env = Math.sin(t * Math.PI) * 0.5;
            const freq = 300 + t * 1000;
            data[i] = (Math.random() * 2 - 1) * env * 0.4;
            data[i] += Math.sin(i / sr * Math.PI * 2 * freq) * env * 0.15;
        }
        return buf;
    }

    _createJumpBuffer(sr) {
        const len = Math.floor(sr * 0.08);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 15);
            // Rising tone pop
            const freq = 180 + t * 300;
            data[i] = Math.sin(i / sr * Math.PI * 2 * freq) * env * 0.25;
            data[i] += (Math.random() * 2 - 1) * env * 0.1;
        }
        return buf;
    }

    _createLandBuffer(sr) {
        const len = Math.floor(sr * 0.1);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 20);
            // Low thud
            data[i] = Math.sin(t * Math.PI * 2 * 70) * env * 0.5;
            data[i] += (Math.random() * 2 - 1) * env * 0.25;
        }
        return buf;
    }

    _createExplosionBuffer(sr) {
        const len = Math.floor(sr * 0.8);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            // Initial blast (fast attack)
            const attack = t < 0.05 ? t / 0.05 : 1;
            const decay = Math.exp(-t * 4);
            const env = attack * decay;
            // Deep rumble + noise
            data[i] = Math.sin(t * Math.PI * 2 * 40) * env * 0.6;
            data[i] += Math.sin(t * Math.PI * 2 * 25) * env * 0.4;
            data[i] += (Math.random() * 2 - 1) * env * 0.5;
            // Debris rattle in tail
            if (t > 0.1) {
                data[i] += (Math.random() * 2 - 1) * decay * 0.2 * Math.sin(t * 80);
            }
        }
        return buf;
    }

    _createGooBuffer(sr) {
        const len = Math.floor(sr * 0.4);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 6);
            // Wet splat: low filtered noise with wobble
            const wobble = Math.sin(t * Math.PI * 2 * 8) * 0.5 + 0.5;
            data[i] = (Math.random() * 2 - 1) * env * 0.4 * wobble;
            data[i] += Math.sin(t * Math.PI * 2 * 150 * (1 - t)) * env * 0.3;
        }
        return buf;
    }

    _createKillConfirmBuffer(sr) {
        const len = Math.floor(sr * 0.25);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 8);
            // Sharp satisfying ding — two harmonics
            data[i] = Math.sin(t * Math.PI * 2 * 880) * env * 0.3;
            data[i] += Math.sin(t * Math.PI * 2 * 1320) * env * 0.2;
        }
        return buf;
    }

    _createDeathBuffer(sr) {
        const len = Math.floor(sr * 0.5);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const env = Math.exp(-t * 3);
            // Descending low tone
            const freq = 200 * (1 - t * 0.6);
            data[i] = Math.sin(i / sr * Math.PI * 2 * freq) * env * 0.4;
            data[i] += (Math.random() * 2 - 1) * env * 0.15;
        }
        return buf;
    }

    // ─── Sound Playback ───

    // Play a 2D sound (UI, local player actions)
    play(name, volume = 1.0, pitch = 1.0) {
        if (!this.initialized || !this.buffers[name]) return;

        const _start = () => {
            const source = this.ctx.createBufferSource();
            source.buffer = this.buffers[name];
            source.playbackRate.value = pitch;

            const gain = this.ctx.createGain();
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(this.sfxGain);
            source.start(0);
            return source;
        };

        if (this.ctx.state === 'suspended') {
            this.ctx.resume().then(_start);
        } else {
            return _start();
        }
    }

    // Play a 3D positional sound (remote player actions, explosions)
    play3D(name, x, y, z, volume = 1.0, pitch = 1.0, refDistance = 5) {
        if (!this.initialized || !this.buffers[name]) return;

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        source.playbackRate.value = pitch;

        const gain = this.ctx.createGain();
        gain.gain.value = volume;

        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = refDistance;
        panner.maxDistance = 50;
        panner.rolloffFactor = 1.5;
        panner.coneOuterGain = 0.3;

        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;

        source.connect(gain);
        gain.connect(panner);
        panner.connect(this.sfxGain);

        source.start(0);
        return source;
    }

    // ─── Game Event Sounds ───

    // Call each frame with local player state
    updateFootsteps(player, dt) {
        if (!this.initialized || !player.alive) return;

        // Only play footsteps when grounded and moving
        if (!player.grounded || player.sliding || player.dashing) {
            this.footstepTimer = 0;
            return;
        }

        const speed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        if (speed < 1.0) {
            this.footstepTimer = 0;
            return;
        }

        // Interval scales with speed — faster = more frequent
        const interval = player.crouching ? 0.45 : (speed > 5 ? 0.28 : 0.35);
        this.footstepTimer += dt;

        if (this.footstepTimer >= interval) {
            this.footstepTimer -= interval;
            this.footstepAlt = !this.footstepAlt;
            // Slight pitch variation for L/R and natural feel
            const pitch = 0.9 + Math.random() * 0.2 + (this.footstepAlt ? 0.05 : 0);
            const vol = player.crouching ? 0.15 : 0.25;
            this.play('footstep', vol, pitch);
        }
    }

    // Remote player footsteps (3D positioned)
    playRemoteFootstep(x, y, z) {
        if (!this.initialized) return;
        const pitch = 0.85 + Math.random() * 0.3;
        this.play3D('footstep', x, y, z, 0.35, pitch, 4);
    }

    // Local player attacks
    playSwing() {
        this.play('swing', 0.35, 0.95 + Math.random() * 0.1);
    }

    playHeavySwing() {
        this.play('heavySwing', 0.45, 0.8 + Math.random() * 0.1);
    }

    playElbow() {
        this.play('elbow', 0.4, 1.0);
    }

    // Hit sounds (local = 2D, remote = 3D)
    playHitLocal(backstab = false) {
        if (backstab) {
            this.play('backstab', 1.0, 1.0);
        } else {
            this.play('hit', 0.45, 0.9 + Math.random() * 0.2);
        }
    }

    playHit3D(x, y, z, backstab = false) {
        if (backstab) {
            this.play3D('backstab', x, y, z, 0.7, 1.0, 6);
        } else {
            this.play3D('hit', x, y, z, 0.5, 0.9 + Math.random() * 0.2, 5);
        }
    }

    // Movement sounds
    playJumpPad() {
        this.play('jumppad', 1.0, 1.0);
    }

    playDash() {
        this.play('dash', 0.4, 1.0 + Math.random() * 0.1);
    }

    playDash3D(x, y, z) {
        this.play3D('dash', x, y, z, 0.45, 1.0, 6);
    }

    playJump() {
        this.play('jump', 0.2, 0.95 + Math.random() * 0.1);
    }

    playLand(fallSpeed = 0) {
        // Louder landing for higher falls
        const vol = Math.min(0.4, 0.15 + Math.abs(fallSpeed) * 0.01);
        this.play('land', vol, 0.8 + Math.random() * 0.15);
    }

    // Slide continuous sound (start/stop)
    startSlideSound() {
        if (!this.initialized || this.isSliding) return;
        this.isSliding = true;

        // Create a looping filtered noise for slide friction
        this.slideOsc = this.ctx.createBufferSource();
        this.slideOsc.buffer = this.buffers.noise;
        this.slideOsc.loop = true;

        // Bandpass filter for friction sound
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 2;

        this.slideGainNode = this.ctx.createGain();
        this.slideGainNode.gain.value = 0;
        // Fade in
        this.slideGainNode.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.05);

        this.slideOsc.connect(filter);
        filter.connect(this.slideGainNode);
        this.slideGainNode.connect(this.sfxGain);
        this.slideOsc.start(0);
    }

    stopSlideSound() {
        if (!this.initialized || !this.isSliding) return;
        this.isSliding = false;

        if (this.slideGainNode) {
            this.slideGainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
        }
        if (this.slideOsc) {
            try { this.slideOsc.stop(this.ctx.currentTime + 0.15); } catch (e) {}
            this.slideOsc = null;
        }
    }

    // World sounds (3D positioned)
    playExplosion(x, y, z) {
        this.play3D('explosion', x, y, z, 0.8, 0.8 + Math.random() * 0.2, 10);
    }

    playGoo(x, y, z) {
        this.play3D('goo', x, y, z, 0.5, 0.9 + Math.random() * 0.2, 6);
    }

    // UI sounds
    playKillConfirm() {
        this.play('killConfirm', 0.4, 1.0);
    }

    playDeath() {
        this.play('death', 0.5, 1.0);
    }

    // Volume control
    setMasterVolume(vol) {
        if (this.masterGain) {
            this.masterGain.gain.value = Math.max(0, Math.min(1, vol));
        }
    }
}
