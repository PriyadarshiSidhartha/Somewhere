// simulation.js — Server-authoritative 3D movement simulation with physics.
//
// The server is the source of truth for all player positions, velocities,
// and grounded state. Clients send directional input + jump + sequence number.
// The server runs the shared physics step (from physics.js) with collision
// detection against the block world.
//
// This module replaces the old flat-XZ movement with full 3D physics:
//   - Acceleration / deceleration
//   - Gravity
//   - Jumping (with coyote time and jump buffering)
//   - Capsule-vs-block collision

const {
    PHYSICS_CONFIG,
    PHYSICS_DT,
    physicsStep,
    createPhysicsState,
    clonePhysicsState,
    capsuleHalfHeight,
} = require("./physics");

// Re-export PHYSICS_CONFIG as WORLD_CONFIG for backwards compatibility
// with server.js and tests that reference WORLD_CONFIG.
const WORLD_CONFIG = {
    moveSpeed:          PHYSICS_CONFIG.moveSpeed,
    simulationTickRate: PHYSICS_CONFIG.physicsTickRate,
    snapshotRate:       PHYSICS_CONFIG.snapshotRate,
    boundXZ:            PHYSICS_CONFIG.boundXZ,
    defaultY:           5, // spawn height (high enough to fall onto terrain)
};

// --------------------------------------------------
// PLAYER STATE
// --------------------------------------------------

// A reference to the world's isSolidAt function, set by the server at startup.
let _worldIsSolidAt = () => false;

function setWorldCollisionFn(fn) {
    _worldIsSolidAt = fn;
}

function createPlayer(socketId, displayName, spawnPos) {
    const spawnX = spawnPos ? spawnPos.x : 0;
    const spawnY = spawnPos ? spawnPos.y : WORLD_CONFIG.defaultY;
    const spawnZ = spawnPos ? spawnPos.z : 0;

    return {
        id: socketId,
        userId: null,
        name: displayName || `Player-${socketId.slice(0, 6)}`,

        // Physics state (position is capsule center).
        physics: createPhysicsState(spawnX, spawnY, spawnZ),

        // Convenience accessor: matches old API.
        get position() { return this.physics.position; },

        // Movement input from the client.
        input: {
            forward: 0,
            strafe: 0,
            yaw: 0,
            jump: false,
        },

        // Sequence number tracking for client reconciliation.
        lastProcessedSeq: -1,

        // Accumulated simulation time for this player.
        simTime: 0,

        // Accumulator for fixed-timestep sub-stepping.
        accumulator: 0,
    };
}

// What we send to other clients — only public information.
function getPublicPlayerState(player) {
    const pos = player.physics.position;
    return {
        id: player.id,
        name: player.name,
        position: {
            x: Math.round(pos.x * 1000) / 1000,
            y: Math.round(pos.y * 1000) / 1000,
            z: Math.round(pos.z * 1000) / 1000,
        },
        yaw: Math.round(player.input.yaw * 1000) / 1000,
    };
}

// --------------------------------------------------
// INPUT VALIDATION
// --------------------------------------------------

function isValidMovementInput(data) {
    if (!data || typeof data !== "object") return false;

    if (typeof data.forward !== "number" || !Number.isFinite(data.forward)) return false;
    if (typeof data.strafe !== "number" || !Number.isFinite(data.strafe)) return false;
    if (typeof data.yaw !== "number" || !Number.isFinite(data.yaw)) return false;

    if (data.forward < -1 || data.forward > 1) return false;
    if (data.strafe < -1 || data.strafe > 1) return false;
    if (Math.abs(data.yaw) > 2 * Math.PI * 100) return false;

    // seq must be a non-negative integer if present.
    if (data.seq !== undefined && data.seq !== null) {
        if (typeof data.seq !== "number" || !Number.isInteger(data.seq) || data.seq < 0) return false;
    }

    return true;
}

function setPlayerMovementInput(player, inputData) {
    if (!isValidMovementInput(inputData)) {
        return false;
    }
    player.input.forward = inputData.forward;
    player.input.strafe = inputData.strafe;
    player.input.yaw = inputData.yaw;
    player.input.jump = !!inputData.jump;

    // Track sequence number.
    if (typeof inputData.seq === "number") {
        player.lastProcessedSeq = inputData.seq;
    }

    return true;
}

function resetPlayerMovementInput(player) {
    if (player && player.input) {
        player.input.forward = 0;
        player.input.strafe = 0;
        player.input.jump = false;
    }
}

// --------------------------------------------------
// MOVEMENT SIMULATION (fixed timestep)
// --------------------------------------------------

function updatePlayerPosition(player, deltaTime) {
    // Accumulate frame time and step in fixed increments.
    player.accumulator += deltaTime;

    // Safety cap: prevent spiral of death if server lags.
    if (player.accumulator > 0.25) {
        player.accumulator = 0.25;
    }

    while (player.accumulator >= PHYSICS_DT) {
        player.accumulator -= PHYSICS_DT;
        player.simTime += PHYSICS_DT;

        physicsStep(
            player.physics,
            player.input,
            _worldIsSolidAt,
            PHYSICS_CONFIG,
            PHYSICS_DT,
            player.simTime
        );
    }
}

function simulateTick(playersIterable, deltaTime) {
    for (const player of playersIterable) {
        updatePlayerPosition(player, deltaTime);
    }
}

// --------------------------------------------------
// SNAPSHOT GENERATION (broadcast to clients)
// --------------------------------------------------

function createSnapshot(playersIterable) {
    const playersList = [];
    for (const player of playersIterable) {
        const pos = player.physics.position;
        const vel = player.physics.velocity;
        playersList.push({
            id: player.id,
            position: {
                x: Math.round(pos.x * 1000) / 1000,
                y: Math.round(pos.y * 1000) / 1000,
                z: Math.round(pos.z * 1000) / 1000,
            },
            velocity: {
                x: Math.round(vel.x * 1000) / 1000,
                y: Math.round(vel.y * 1000) / 1000,
                z: Math.round(vel.z * 1000) / 1000,
            },
            yaw: Math.round(player.input.yaw * 1000) / 1000,
            grounded: player.physics.grounded,
            jumpWasPressed: !!player.physics.jumpWasPressed,
            lastProcessedSeq: player.lastProcessedSeq,
        });
    }
    return { timestamp: Date.now(), players: playersList };
}

module.exports = {
    WORLD_CONFIG,
    PHYSICS_CONFIG,
    PHYSICS_DT,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    updatePlayerPosition,
    simulateTick,
    createSnapshot,
    setWorldCollisionFn,
};
