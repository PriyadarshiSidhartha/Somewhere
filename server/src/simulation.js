// simulation.js — Server-authoritative 3D movement simulation.
//
// The server is the source of truth for all player positions.
// Clients send directional input (which keys are pressed + camera yaw).
// The server computes actual world-space velocity and updates positions.
//
// Why server-authoritative? It prevents clients from teleporting themselves
// or cheating by sending fake positions.

// --------------------------------------------------
// WORLD CONFIGURATION
// --------------------------------------------------

const WORLD_CONFIG = {
    moveSpeed: 8,          // units per second (feels like a walking pace)
    simulationTickRate: 30, // 30 ticks per second (~33ms per tick)
    snapshotRate: 20,       // 20 position broadcasts per second (50ms)
    // XZ bounds — same as worldState.js limit (30 units from center)
    boundXZ: 30,
    // Y: player walks at a fixed height above the ground
    defaultY: 2.5,
};

// --------------------------------------------------
// PLAYER STATE
// --------------------------------------------------

function createPlayer(socketId, displayName, spawnPos) {
    return {
        id: socketId,
        // The database User ID — set after authentication.
        userId: null,
        name: displayName || `Player-${socketId.slice(0, 6)}`,
        position: {
            x: spawnPos ? spawnPos.x : 0,
            y: spawnPos ? spawnPos.y : WORLD_CONFIG.defaultY,
            z: spawnPos ? spawnPos.z : 0,
        },
        // Movement input: direction keys + camera yaw angle in radians.
        input: {
            forward: 0,  // -1 to 1 (negative = backward)
            strafe: 0,   // -1 to 1 (negative = left)
            yaw: 0,      // camera horizontal rotation (radians)
        },
    };
}

// What we send to other clients — only public information.
// Never expose internal input state.
function getPublicPlayerState(player) {
    return {
        id: player.id,
        name: player.name,
        position: {
            x: Math.round(player.position.x * 1000) / 1000,
            y: Math.round(player.position.y * 1000) / 1000,
            z: Math.round(player.position.z * 1000) / 1000,
        },
        yaw: Math.round(player.input.yaw * 1000) / 1000, // for orienting other players' meshes
    };
}

// --------------------------------------------------
// INPUT VALIDATION
// --------------------------------------------------

function isValidMovementInput(data) {
    if (!data || typeof data !== "object") return false;

    // forward/strafe must be numbers in [-1, 1]
    if (typeof data.forward !== "number" || !Number.isFinite(data.forward)) return false;
    if (typeof data.strafe  !== "number" || !Number.isFinite(data.strafe))  return false;
    if (typeof data.yaw     !== "number" || !Number.isFinite(data.yaw))     return false;

    if (data.forward < -1 || data.forward > 1) return false;
    if (data.strafe  < -1 || data.strafe  > 1) return false;
    // yaw is any angle in radians — just check it's a reasonable number
    if (Math.abs(data.yaw) > 2 * Math.PI * 100) return false;

    return true;
}

function setPlayerMovementInput(player, inputData) {
    if (!isValidMovementInput(inputData)) {
        return false;
    }
    player.input.forward = inputData.forward;
    player.input.strafe  = inputData.strafe;
    player.input.yaw     = inputData.yaw;
    return true;
}

function resetPlayerMovementInput(player) {
    if (player && player.input) {
        player.input.forward = 0;
        player.input.strafe  = 0;
    }
}

// --------------------------------------------------
// MOVEMENT SIMULATION
// --------------------------------------------------

function updatePlayerPosition(player, deltaTime) {
    const { forward, strafe, yaw } = player.input;

    if (forward === 0 && strafe === 0) return;

    // Decompose forward/strafe into world-space XZ velocity using the camera yaw.
    // yaw=0 → facing +Z, yaw=π/2 → facing +X (standard 3D convention).
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    // Forward vector in world XZ: (sinYaw, cosYaw)
    // Strafe vector is perpendicular: (cosYaw, -sinYaw)
    let dx = sinYaw * forward + cosYaw * strafe;
    let dz = cosYaw * forward - sinYaw * strafe;

    // Normalize diagonal movement so you don't go faster diagonally.
    const magnitude = Math.hypot(dx, dz);
    if (magnitude > 1) {
        dx /= magnitude;
        dz /= magnitude;
    }

    // Cap delta time to prevent huge jumps on lag spikes.
    const dt = Math.min(deltaTime, 0.1);

    player.position.x += dx * WORLD_CONFIG.moveSpeed * dt;
    player.position.z += dz * WORLD_CONFIG.moveSpeed * dt;

    // Clamp to world XZ bounds.
    const b = WORLD_CONFIG.boundXZ;
    player.position.x = Math.max(-b, Math.min(b, player.position.x));
    player.position.z = Math.max(-b, Math.min(b, player.position.z));

    // Y stays fixed (no gravity/jumping in MVP).
    player.position.y = WORLD_CONFIG.defaultY;
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
        playersList.push({
            id: player.id,
            position: {
                x: Math.round(player.position.x * 1000) / 1000,
                y: Math.round(player.position.y * 1000) / 1000,
                z: Math.round(player.position.z * 1000) / 1000,
            },
            yaw: Math.round(player.input.yaw * 1000) / 1000,
        });
    }
    return { timestamp: Date.now(), players: playersList };
}

module.exports = {
    WORLD_CONFIG,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    updatePlayerPosition,
    simulateTick,
    createSnapshot,
};
