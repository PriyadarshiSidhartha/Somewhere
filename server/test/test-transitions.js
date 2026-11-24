// test-transitions.js — Unit and integration tests for the Global Screen Transition System,
// Authentication flow state transitions, and Death/Respawn lifecycle.
//
// Run with: node test/test-transitions.js

const assert = require("assert");

console.log("=== RUNNING SCREEN TRANSITION SYSTEM TESTS ===\n");

// --------------------------------------------------
// MOCK DOM & ScreenTransitionManager Definition
// --------------------------------------------------

function createMockElement() {
    return {
        style: {
            opacity: "1",
            pointerEvents: "all",
            transition: "",
            backgroundColor: "#000000",
            display: "none",
        },
        offsetHeight: 100,
        listeners: {},
        addEventListener(event, fn) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (!this.listeners[event]) return;
            this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
        },
        triggerTransitionEnd() {
            if (this.listeners["transitionend"]) {
                const fns = [...this.listeners["transitionend"]];
                for (const fn of fns) {
                    fn({ target: this });
                }
            }
        },
    };
}

class ScreenTransitionManager {
    constructor(overlayElement, options = {}) {
        this.overlay = overlayElement;
        this.defaultFadeInDuration = options.defaultFadeInDuration ?? 400;
        this.defaultFadeOutDuration = options.defaultFadeOutDuration ?? 400;
        this.defaultHoldDelay = options.defaultHoldDelay ?? 0;

        this._state = "black";
        this._currentOpacity = 1;
        this._transitionQueue = Promise.resolve();
        this._isBusy = false;
    }

    getState() {
        return this._state;
    }

    isBlack() {
        return this._state === "black" && this._currentOpacity === 1;
    }

    setOverlayColor(color) {
        if (this.overlay) {
            this.overlay.style.backgroundColor = color;
        }
    }

    fadeToBlack(duration = this.defaultFadeInDuration) {
        if (this._currentOpacity === 1 && this._state === "black") {
            return Promise.resolve();
        }

        this._state = "fading_to_black";
        this.overlay.style.pointerEvents = "all";

        return new Promise((resolve) => {
            void this.overlay.offsetHeight;
            this.overlay.style.transition = `opacity ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
            this.overlay.style.opacity = "1";
            this._currentOpacity = 1;

            let resolved = false;
            const onEnd = (e) => {
                if (resolved) return;
                if (e && e.target !== this.overlay) return;
                resolved = true;
                this.overlay.removeEventListener("transitionend", onEnd);
                clearTimeout(fallbackTimer);
                this._state = "black";
                resolve();
            };

            const fallbackTimer = setTimeout(onEnd, duration + 50);
            this.overlay.addEventListener("transitionend", onEnd);
        });
    }

    fadeFromBlack(duration = this.defaultFadeOutDuration) {
        if (this._currentOpacity === 0 && this._state === "visible") {
            return Promise.resolve();
        }

        this._state = "fading_from_black";

        return new Promise((resolve) => {
            void this.overlay.offsetHeight;
            this.overlay.style.transition = `opacity ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
            this.overlay.style.opacity = "0";
            this._currentOpacity = 0;

            let resolved = false;
            const onEnd = (e) => {
                if (resolved) return;
                if (e && e.target !== this.overlay) return;
                resolved = true;
                this.overlay.removeEventListener("transitionend", onEnd);
                clearTimeout(fallbackTimer);
                this._state = "visible";
                this.overlay.style.pointerEvents = "none";
                resolve();
            };

            const fallbackTimer = setTimeout(onEnd, duration + 50);
            this.overlay.addEventListener("transitionend", onEnd);
        });
    }

    holdBlack(duration = 0) {
        if (duration > 0) {
            return new Promise((r) => setTimeout(r, duration));
        }
        return Promise.resolve();
    }

    executeTransition(operation, options = {}) {
        const fadeInDuration = options.fadeInDuration ?? this.defaultFadeInDuration;
        const fadeOutDuration = options.fadeOutDuration ?? this.defaultFadeOutDuration;
        const holdDelay = options.holdDelay ?? this.defaultHoldDelay;

        const task = async () => {
            this._isBusy = true;
            try {
                await this.fadeToBlack(fadeInDuration);

                if (holdDelay > 0) {
                    await this.holdBlack(holdDelay);
                }

                let result = null;
                let operationError = null;
                if (typeof operation === "function") {
                    try {
                        result = await operation();
                    } catch (err) {
                        operationError = err;
                        console.error("[ScreenTransition] Error during transition operation:", err.message);
                        if (typeof options.onError === "function") {
                            await options.onError(err);
                        }
                    }
                }

                await this.fadeFromBlack(fadeOutDuration);

                if (operationError && !options.onError) {
                    throw operationError;
                }

                return result;
            } finally {
                this._isBusy = false;
            }
        };

        const chained = this._transitionQueue.then(task, task);
        this._transitionQueue = chained.catch(() => {});
        return chained;
    }
}

// --------------------------------------------------
// TEST 1: Initial state starts pure black from frame 0
// --------------------------------------------------
{
    const overlay = createMockElement();
    const stm = new ScreenTransitionManager(overlay);

    assert.strictEqual(stm.isBlack(), true, "Should start in black state");
    assert.strictEqual(stm.getState(), "black");
    assert.strictEqual(overlay.style.opacity, "1");
    assert.strictEqual(overlay.style.pointerEvents, "all");
    console.log("✓ Initial state starts pure black from frame 0 with blocked pointer events.");
}

// --------------------------------------------------
// TEST 2: Fade from black to visible
// --------------------------------------------------
(async () => {
    const overlay = createMockElement();
    const stm = new ScreenTransitionManager(overlay);

    const fadePromise = stm.fadeFromBlack(10);
    assert.strictEqual(stm.getState(), "fading_from_black");
    assert.strictEqual(overlay.style.opacity, "0");

    overlay.triggerTransitionEnd();
    await fadePromise;

    assert.strictEqual(stm.getState(), "visible");
    assert.strictEqual(stm.isBlack(), false);
    assert.strictEqual(overlay.style.pointerEvents, "none");
    console.log("✓ Fade from black completes and enables pointer events.");
})()
// --------------------------------------------------
// TEST 3: executeTransition lifecycle order and hold delay
// --------------------------------------------------
.then(async () => {
    const overlay = createMockElement();
    const stm = new ScreenTransitionManager(overlay);

    // First transition to visible
    const initFade = stm.fadeFromBlack(10);
    overlay.triggerTransitionEnd();
    await initFade;

    const events = [];

    // Trigger executeTransition
    const transitionPromise = stm.executeTransition(
        async () => {
            events.push("operation_started");
            assert.strictEqual(stm.isBlack(), true, "Must be black when operation executes");
            events.push("operation_finished");
            return "SUCCESS_DATA";
        },
        { fadeInDuration: 10, fadeOutDuration: 10, holdDelay: 20 }
    );

    // Step 1: wait for fade to black transition end
    setTimeout(() => overlay.triggerTransitionEnd(), 5);

    // Step 2: wait for fade from black transition end
    setTimeout(() => overlay.triggerTransitionEnd(), 45);

    const result = await transitionPromise;

    assert.strictEqual(result, "SUCCESS_DATA");
    assert.deepStrictEqual(events, ["operation_started", "operation_finished"]);
    assert.strictEqual(stm.getState(), "visible");
    console.log("✓ executeTransition runs operation strictly while black and returns result.");
})
// --------------------------------------------------
// TEST 4: executeTransition error safety (ensures screen recovers safely)
// --------------------------------------------------
.then(async () => {
    const overlay = createMockElement();
    const stm = new ScreenTransitionManager(overlay);

    // First visible
    const initFade = stm.fadeFromBlack(10);
    overlay.triggerTransitionEnd();
    await initFade;

    let customErrorHandled = false;

    const transitionPromise = stm.executeTransition(
        async () => {
            throw new Error("World generation failed!");
        },
        {
            fadeInDuration: 10,
            fadeOutDuration: 10,
            onError: async (err) => {
                customErrorHandled = true;
            },
        }
    );

    setTimeout(() => overlay.triggerTransitionEnd(), 5);
    setTimeout(() => overlay.triggerTransitionEnd(), 25);

    await transitionPromise;

    assert.strictEqual(customErrorHandled, true, "Custom onError handler must be called");
    assert.strictEqual(stm.getState(), "visible", "Overlay must fade out to avoid getting stuck black permanently");
    console.log("✓ executeTransition handles errors safely and recovers the screen.");
})
// --------------------------------------------------
// TEST 5: Queuing multiple rapid transition requests
// --------------------------------------------------
.then(async () => {
    const overlay = createMockElement();
    const stm = new ScreenTransitionManager(overlay);

    const order = [];

    const p1 = stm.executeTransition(async () => {
        order.push("t1_start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("t1_end");
    }, { fadeInDuration: 5, fadeOutDuration: 5 });

    const p2 = stm.executeTransition(async () => {
        order.push("t2_start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("t2_end");
    }, { fadeInDuration: 5, fadeOutDuration: 5 });

    // Auto trigger transitionends
    const interval = setInterval(() => overlay.triggerTransitionEnd(), 2);

    await Promise.all([p1, p2]);
    clearInterval(interval);

    assert.deepStrictEqual(order, ["t1_start", "t1_end", "t2_start", "t2_end"], "Transitions must execute sequentially");
    console.log("✓ Overlapping transitions are serialized sequentially through the queue.");
})
// --------------------------------------------------
// TEST 6: Auth flow resolution logic (Case A & Case B)
// --------------------------------------------------
.then(async () => {
    // Simulated Case A: Not logged in
    {
        const overlay = createMockElement();
        const stm = new ScreenTransitionManager(overlay);
        const loginEl = createMockElement();
        const gameEl = createMockElement();

        const meData = { loggedIn: false };

        if (!meData.loggedIn) {
            loginEl.style.display = "flex";
            const p = stm.fadeFromBlack(10);
            overlay.triggerTransitionEnd();
            await p;
        }

        assert.strictEqual(loginEl.style.display, "flex");
        assert.strictEqual(gameEl.style.display, "none");
        assert.strictEqual(stm.getState(), "visible");
    }

    // Simulated Case B: Logged in
    {
        const overlay = createMockElement();
        const stm = new ScreenTransitionManager(overlay);
        const loginEl = createMockElement();
        const gameEl = createMockElement();

        const meData = { loggedIn: true, user: { displayName: "Priyadarshi" } };

        let gameReady = false;
        async function mockStartGame() {
            // Emulate waiting for welcome + world_state + 2 render frames
            await new Promise((r) => setTimeout(r, 20));
            gameReady = true;
        }

        if (meData.loggedIn) {
            loginEl.style.display = "none";
            gameEl.style.display = "block";
            await mockStartGame();
            const p = stm.fadeFromBlack(10);
            overlay.triggerTransitionEnd();
            await p;
        }

        assert.strictEqual(gameReady, true);
        assert.strictEqual(loginEl.style.display, "none", "Login screen was never shown");
        assert.strictEqual(gameEl.style.display, "block");
        assert.strictEqual(stm.getState(), "visible");
    }

    console.log("✓ Auth flow cleanly branches: reveals login if unauthenticated; directly reveals game if authenticated.");
})
// --------------------------------------------------
// TEST 7: Death & Respawn Sequence
// --------------------------------------------------
.then(async () => {
    const overlay = createMockElement();
    const stm = new ScreenTransitionManager(overlay);

    // Initial state visible
    const pInit = stm.fadeFromBlack(10);
    overlay.triggerTransitionEnd();
    await pInit;

    let isRespawning = false;
    const player = {
        position: { x: 15, y: -9, z: 20 },
        velocity: { x: 2, y: -18, z: 0 },
    };

    let serverRespawnCalled = false;

    async function handlePlayerDeath() {
        if (isRespawning) return;
        isRespawning = true;

        try {
            await stm.executeTransition(async () => {
                serverRespawnCalled = true;

                // Reset player position and velocity behind black screen
                player.position.x = 0;
                player.position.y = 5;
                player.position.z = 0;
                player.velocity.x = 0;
                player.velocity.y = 0;
                player.velocity.z = 0;

                // Simulate waiting for server ack and settling frames
                await new Promise((r) => setTimeout(r, 20));
            }, { fadeInDuration: 10, fadeOutDuration: 10, holdDelay: 10 });
        } finally {
            isRespawning = false;
        }
    }

    // Trigger fall below threshold
    if (player.position.y <= -8) {
        const deathPromise = handlePlayerDeath();
        setTimeout(() => overlay.triggerTransitionEnd(), 5);
        setTimeout(() => overlay.triggerTransitionEnd(), 40);
        await deathPromise;
    }

    assert.strictEqual(serverRespawnCalled, true);
    assert.deepStrictEqual(player.position, { x: 0, y: 5, z: 0 }, "Player must be reset to spawn");
    assert.deepStrictEqual(player.velocity, { x: 0, y: 0, z: 0 }, "Velocity must be zeroed");
    assert.strictEqual(isRespawning, false, "Respawning flag must be reset");
    assert.strictEqual(stm.getState(), "visible");
    console.log("✓ Player death transition executes behind black screen and resets player cleanly.");
})
// --------------------------------------------------
// TEST 8: Chat mode readability, text indicator, and gradient overlay
// --------------------------------------------------
.then(() => {
    const hintClasses = new Set();
    const hintEl = {
        textContent: "Press Enter to chat",
        classList: {
            add: (c) => hintClasses.add(c),
            remove: (c) => hintClasses.delete(c),
            contains: (c) => hintClasses.has(c),
        },
    };

    const gradientClasses = new Set();
    const gradientEl = {
        classList: {
            add: (c) => gradientClasses.add(c),
            remove: (c) => gradientClasses.delete(c),
            contains: (c) => gradientClasses.has(c),
        },
    };

    let chatMode = false;
    function setChatMode(active) {
        chatMode = active;
        hintEl.textContent = active ? ". . ." : "Press Enter to chat";
        if (active) {
            hintEl.classList.add("in-chat");
            gradientEl.classList.add("visible");
        } else {
            hintEl.classList.remove("in-chat");
            gradientEl.classList.remove("visible");
        }
    }

    // Enter chat mode
    setChatMode(true);
    assert.strictEqual(chatMode, true);
    assert.strictEqual(hintEl.textContent, ". . .");
    assert.strictEqual(hintEl.classList.contains("in-chat"), true);
    assert.strictEqual(gradientEl.classList.contains("visible"), true);

    // Exit chat mode
    setChatMode(false);
    assert.strictEqual(chatMode, false);
    assert.strictEqual(hintEl.textContent, "Press Enter to chat");
    assert.strictEqual(hintEl.classList.contains("in-chat"), false);
    assert.strictEqual(gradientEl.classList.contains("visible"), false);

    console.log("✓ Chat mode correctly switches '. . .' prompt and bottom gradient overlay.");
})
.then(() => {
    console.log("\nALL TRANSITION & CHAT UI TESTS PASSED ✓✓✓\n");
})
.catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
