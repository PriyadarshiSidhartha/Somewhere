// test-simulation.js — Unit tests for the 3D movement simulation.
//
// Updated for the physics-based simulation system.
// Run with: node test/test-simulation.js

const assert = require("assert");
const {
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
} = require("../src/simulation");

console.log("=== RUNNING 3D SIMULATION UNIT TESTS ===\n");

// Set up a simple collision world for tests: flat floor at y=0.
function testIsSolidAt(x, y, z) {
    const bx = Math.round(x);
    const by = Math.round(y);
    const bz = Math.round(z);
    // Flat floor: solid at y=0, nothing else.
    return by === 0 && bx >= -10 && bx < 10 && bz >= -10 && bz < 10;
}
setWorldCollisionFn(testIsSolidAt);

// TEST 1: World config exists
assert(typeof WORLD_CONFIG.moveSpeed === "number", "moveSpeed must be a number");
assert(typeof WORLD_CONFIG.simulationTickRate === "number", "tick rate must be a number");
assert(typeof WORLD_CONFIG.boundXZ === "number", "boundXZ must be a number");
console.log(`✓ World config: speed=${WORLD_CONFIG.moveSpeed}, tickRate=${WORLD_CONFIG.simulationTickRate}`);

// TEST 2: Player creation
const p1 = createPlayer("socket-1", "Alice", { x: 5, y: 2.5, z: 3 });
assert.strictEqual(p1.id, "socket-1");
assert.strictEqual(p1.name, "Alice");
assert.strictEqual(p1.position.x, 5);
assert.strictEqual(p1.position.y, 2.5);
assert.strictEqual(p1.position.z, 3);
assert.strictEqual(p1.input.forward, 0);
assert.strictEqual(p1.input.strafe, 0);
console.log("✓ Player creation verified.");

// TEST 3: Public state never exposes internal input
const pub = getPublicPlayerState(p1);
assert.strictEqual(pub.id, p1.id);
assert.strictEqual(pub.input, undefined, "input must NEVER be in public state");
// Mutating public state must NOT change internal state
pub.position.x = 999;
assert.strictEqual(p1.position.x, 5, "Internal position must not be mutable via public state");
console.log("✓ Public state encapsulation verified.");

// TEST 4: Input validation
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0 }), true);
assert.strictEqual(isValidMovementInput({ forward: 1, strafe: 0, yaw: 1.57 }), true);
assert.strictEqual(isValidMovementInput({ forward: -1, strafe: 1, yaw: -3.14 }), true);
// With seq
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, seq: 0 }), true);
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, seq: 42 }), true);
// With jump
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, jump: true }), true);

// Invalid inputs
assert.strictEqual(isValidMovementInput(null), false, "null rejected");
assert.strictEqual(isValidMovementInput(undefined), false, "undefined rejected");
assert.strictEqual(isValidMovementInput({}), false, "empty object rejected");
assert.strictEqual(isValidMovementInput({ forward: 2, strafe: 0, yaw: 0 }), false, "forward > 1 rejected");
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 2, yaw: 0 }), false, "strafe > 1 rejected");
assert.strictEqual(isValidMovementInput({ forward: NaN, strafe: 0, yaw: 0 }), false, "NaN rejected");
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: Infinity, yaw: 0 }), false, "Infinity rejected");
// Invalid seq
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, seq: -1 }), false, "negative seq rejected");
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, seq: 1.5 }), false, "float seq rejected");
// Coordinate injection attempt
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, position: { x: 999 } }), true,
    "Extra fields accepted (only forward/strafe/yaw are used)");
console.log("✓ Input validation verified.");

// TEST 5: Movement actually moves the player
// With the physics system, the player spawns above the floor and falls.
// First let them settle onto the ground.
const pMove = createPlayer("p-move", "Mover", { x: 0, y: 5, z: 0 });
// Let gravity settle the player onto the floor (y=0 blocks).
for (let i = 0; i < 120; i++) updatePlayerPosition(pMove, PHYSICS_DT);
// Player should be grounded now.
assert(pMove.physics.grounded, "Player should be grounded after settling");

// Now apply forward movement.
setPlayerMovementInput(pMove, { forward: 1, strafe: 0, yaw: 0, seq: 0 });
const startZ = pMove.position.z;
// Simulate 1 second (at the physics tick rate).
for (let i = 0; i < 60; i++) updatePlayerPosition(pMove, PHYSICS_DT);
const movedZ = pMove.position.z - startZ;
// Should have moved roughly moveSpeed units along -Z.
assert(
    Math.abs(movedZ + PHYSICS_CONFIG.moveSpeed) < 2.0, // within 2 units (acceleration ramp)
    `Expected z movement ≈${-PHYSICS_CONFIG.moveSpeed}, got ${movedZ.toFixed(2)}`
);
console.log(`✓ Forward movement: moved ${movedZ.toFixed(2)} units in z in ~1s.`);

// TEST 6: World XZ boundary clamping
const pClamp = createPlayer("p-clamp", "Clamp", { x: 29, y: 5, z: 0 });
// Settle
for (let i = 0; i < 120; i++) updatePlayerPosition(pClamp, PHYSICS_DT);
setPlayerMovementInput(pClamp, { forward: 0, strafe: 1, yaw: 0, seq: 0 });
for (let i = 0; i < 300; i++) {
    updatePlayerPosition(pClamp, PHYSICS_DT);
}
const b = WORLD_CONFIG.boundXZ;
assert(pClamp.position.x <= b, `x must not exceed ${b}`);
assert(pClamp.position.z <= b, `z must not exceed ${b}`);
console.log(`✓ XZ boundary clamping verified (bound: ±${b}).`);

// TEST 7: Diagonal speed normalization
const pDiag = createPlayer("p-diag", "Diag", { x: 0, y: 5, z: 0 });
// Settle
for (let i = 0; i < 120; i++) updatePlayerPosition(pDiag, PHYSICS_DT);
const diagStartX = pDiag.position.x;
const diagStartZ = pDiag.position.z;
setPlayerMovementInput(pDiag, { forward: 1, strafe: 1, yaw: 0, seq: 0 });
for (let i = 0; i < 120; i++) updatePlayerPosition(pDiag, PHYSICS_DT);
const diagDist = Math.hypot(
    pDiag.position.x - diagStartX,
    pDiag.position.z - diagStartZ
);
// After 2s with acceleration, diagonal should not exceed moveSpeed * 2.
assert(
    diagDist <= PHYSICS_CONFIG.moveSpeed * 2 + 1,
    `Diagonal distance should not exceed ${PHYSICS_CONFIG.moveSpeed * 2}, got ${diagDist.toFixed(4)}`
);
console.log(`✓ Diagonal normalization: dist = ${diagDist.toFixed(4)} (bounded correctly).`);

// TEST 8: Snapshot structure
const pA = createPlayer("sA", "PlayerA", { x: 1, y: 2.5, z: 2 });
const pB = createPlayer("sB", "PlayerB", { x: 3, y: 2.5, z: 4 });
const snap = createSnapshot([pA, pB]);
assert(typeof snap.timestamp === "number", "snapshot has timestamp");
assert(Array.isArray(snap.players), "snapshot has players array");
assert.strictEqual(snap.players.length, 2, "snapshot has 2 players");
assert.strictEqual(snap.players[0].id, "sA", "first player id correct");
assert(typeof snap.players[0].yaw === "number", "yaw present in snapshot");
// New fields in snapshot
assert(typeof snap.players[0].velocity === "object", "velocity in snapshot");
assert(typeof snap.players[0].grounded === "boolean", "grounded in snapshot");
assert(typeof snap.players[0].lastProcessedSeq === "number", "lastProcessedSeq in snapshot");
console.log("✓ Snapshot structure verified.");

console.log("\nALL TESTS PASSED ✓✓✓\n");
