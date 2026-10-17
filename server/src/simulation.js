// --------------------------------------------------
// WORLD & MOVEMENT SIMULATION CONFIGURATION
// --------------------------------------------------

const WORLD_CONFIG = {
    width: 800,
    height: 400,
    playerRadius: 12,
    moveSpeed: 180, // units per second
    simulationTickRate: 30, // 30 ticks per second (~33.33ms)
    snapshotRate: 20 // 20 broadcasts per second (50ms)
};

const WORLD_BOUNDS = {
    minX: WORLD_CONFIG.playerRadius,
    maxX: WORLD_CONFIG.width - WORLD_CONFIG.playerRadius,
    minY: WORLD_CONFIG.playerRadius,
    maxY: WORLD_CONFIG.height - WORLD_CONFIG.playerRadius
};

const DEFAULT_SPAWN = {
    x: 200,
    y: 200
};

// --------------------------------------------------
// PLAYER STATE CREATION & SERIALIZATION
// --------------------------------------------------

function createPlayer(id, name, dimensionId = "main", spawnPos = DEFAULT_SPAWN) {
    return {
        id,
        name: name || `Player-${id.slice(0, 6)}`,
        dimensionId,
        position: {
            x: Math.max(WORLD_BOUNDS.minX, Math.min(WORLD_BOUNDS.maxX, spawnPos.x)),
            y: Math.max(WORLD_BOUNDS.minY, Math.min(WORLD_BOUNDS.maxY, spawnPos.y))
        },
        input: {
            x: 0,
            y: 0
        }
    };
}

function getPublicPlayerState(player) {
    return {
        id: player.id,
        name: player.name,
        dimensionId: player.dimensionId,
        position: {
            x: Math.round(player.position.x * 100) / 100,
            y: Math.round(player.position.y * 100) / 100
        }
    };
}

// --------------------------------------------------
// INPUT VALIDATION
// --------------------------------------------------

function isValidMovementInput(data) {
    if (!data || typeof data !== "object") {
        return false;
    }

    if (typeof data.x !== "number" || !Number.isFinite(data.x)) {
        return false;
    }

    if (typeof data.y !== "number" || !Number.isFinite(data.y)) {
        return false;
    }

    // Directional inputs must be in the range [-1, 1]
    if (data.x < -1 || data.x > 1 || data.y < -1 || data.y > 1) {
        return false;
    }

    return true;
}

function setPlayerMovementInput(player, inputData) {
    if (!isValidMovementInput(inputData)) {
        return false;
    }

    // Only directional intent is accepted; coordinates are ignored
    player.input.x = inputData.x;
    player.input.y = inputData.y;
    return true;
}

function resetPlayerMovementInput(player) {
    if (player && player.input) {
        player.input.x = 0;
        player.input.y = 0;
    }
}

// --------------------------------------------------
// MOVEMENT SIMULATION TICK
// --------------------------------------------------

function updatePlayerPosition(player, deltaTime) {
    let dx = player.input.x;
    let dy = player.input.y;

    if (dx === 0 && dy === 0) {
        return;
    }

    // Normalize diagonal movement if magnitude > 1
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1) {
        dx /= magnitude;
        dy /= magnitude;
    }

    player.position.x += dx * WORLD_CONFIG.moveSpeed * deltaTime;
    player.position.y += dy * WORLD_CONFIG.moveSpeed * deltaTime;

    // Constrain position within server-authoritative world boundaries
    player.position.x = Math.max(
        WORLD_BOUNDS.minX,
        Math.min(WORLD_BOUNDS.maxX, player.position.x)
    );
    player.position.y = Math.max(
        WORLD_BOUNDS.minY,
        Math.min(WORLD_BOUNDS.maxY, player.position.y)
    );
}

function simulateTick(playersIterable, deltaTime) {
    // Prevent excessive movement caused by unusually large elapsed-time values
    const cappedDelta = Math.min(Math.max(deltaTime, 0), 0.1);

    for (const player of playersIterable) {
        updatePlayerPosition(player, cappedDelta);
    }
}

// --------------------------------------------------
// SNAPSHOT GENERATION
// --------------------------------------------------

function createDimensionSnapshots(playersIterable) {
    const dimensionMap = new Map();
    const timestamp = Date.now();

    for (const player of playersIterable) {
        let list = dimensionMap.get(player.dimensionId);
        if (!list) {
            list = [];
            dimensionMap.set(player.dimensionId, list);
        }

        list.push({
            id: player.id,
            position: {
                x: Math.round(player.position.x * 100) / 100,
                y: Math.round(player.position.y * 100) / 100
            }
        });
    }

    const snapshots = [];
    for (const [dimensionId, playersList] of dimensionMap.entries()) {
        snapshots.push({
            dimensionId,
            snapshot: {
                timestamp,
                players: playersList
            }
        });
    }

    return snapshots;
}

module.exports = {
    WORLD_CONFIG,
    WORLD_BOUNDS,
    DEFAULT_SPAWN,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    updatePlayerPosition,
    simulateTick,
    createDimensionSnapshots
};
