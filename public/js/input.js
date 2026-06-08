import { CONFIG } from './config.js?v=8';

// Tracks all input state for the local player
export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.keys = {};
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        this.leftClick = false;
        this.leftClickJust = false; // one-shot — true only on the first frame of a click
        this.rightClick = false;
        this.rightClickHeld = false;
        this.middleClick = false;
        this.scrollUp = false;
        this.scrollDown = false;
        this.thumbButton = false;
        this.pointerLocked = false;
        this.fKeyJust   = false;
        this.eKeyJust   = false;
        this.qKeyJust   = false;
        this.digit2Just = false;

        // Double-tap tracking not needed here (no drop-through)

        this._bindEvents();
    }

    _bindEvents() {
        // Keyboard
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyF'   && !this.keys['KeyF'])   this.fKeyJust   = true;
            if (e.code === 'KeyE'   && !this.keys['KeyE'])   this.eKeyJust   = true;
            if (e.code === 'KeyQ'   && !this.keys['KeyQ'])   this.qKeyJust   = true;
            if (e.code === 'Digit2' && !this.keys['Digit2']) this.digit2Just = true;
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Pointer lock
        this.canvas.addEventListener('click', () => {
            if (!this.pointerLocked) {
                this.canvas.requestPointerLock().catch(() => {});
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.pointerLocked = document.pointerLockElement === this.canvas;
        });

        // Mouse movement
        document.addEventListener('mousemove', (e) => {
            if (!this.pointerLocked) return;
            this.mouseDeltaX += e.movementX;
            this.mouseDeltaY += e.movementY;
        });

        // Mouse buttons
        this.canvas.addEventListener('mousedown', (e) => {
            if (!this.pointerLocked) return;
            e.preventDefault();
            if (e.button === 0) { this.leftClick = true; this.leftClickJust = true; }
            if (e.button === 1) this.middleClick = true;  // Middle mouse
            if (e.button === 2) {
                this.rightClick = true;
                this.rightClickHeld = true;
            }
            if (e.button === 3) this.thumbButton = true;   // Mouse thumb (button 4 = index 3)
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.leftClick = false;
            if (e.button === 2) this.rightClickHeld = false;
            if (e.button === 3) this.thumbButton = false;
        });

        // Scroll wheel
        this.canvas.addEventListener('wheel', (e) => {
            if (!this.pointerLocked) return;
            e.preventDefault();
            if (e.deltaY < 0) this.scrollUp = true;
            if (e.deltaY > 0) this.scrollDown = true;
        }, { passive: false });

        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Get current input snapshot to send to server
    getInputState() {
        const input = {
            forward: this.keys['KeyW'] || false,
            backward: this.keys['KeyS'] || false,
            left: this.keys['KeyA'] || false,
            right: this.keys['KeyD'] || false,
            jump: this.keys['Space'] || this.scrollDown || false,
            crouch: this.keys['ControlLeft'] || false,
            dash: this.keys['ShiftLeft'] || false,
            primaryAttack: this.leftClick,
            chargedAttack: this.rightClickHeld,
            elbow: this.scrollUp,
            ability1: this.middleClick,
            ability2: this.thumbButton,
            mouseDeltaX: this.mouseDeltaX * CONFIG.MOUSE_SENSITIVITY,
            mouseDeltaY: this.mouseDeltaY * CONFIG.MOUSE_SENSITIVITY,
            // One-shot triggers
            leftClickJust: this.leftClickJust,
            digit2Just:    this.digit2Just,
            qKeyJust:      this.qKeyJust,
            interact:      this.fKeyJust,
            useGateway:    this.eKeyJust,
            rightClickJust: this.rightClick,
        };

        // Reset per-frame triggers
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        this.scrollUp    = false;
        this.scrollDown  = false;
        this.middleClick = false;
        this.rightClick  = false;
        this.leftClickJust = false;
        this.digit2Just  = false;
        this.qKeyJust    = false;
        this.fKeyJust    = false;
        this.eKeyJust    = false;

        return input;
    }
}
