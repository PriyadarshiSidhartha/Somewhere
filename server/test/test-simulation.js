// test-simulation.js — Unit tests for the 3D movement simulation.
//
// Run with: node test/test-simulation.js

const assert = require("assert");
const {
    WORLD_CONFIG,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    updatePlayerPosition,
    simulateTick,
    createSnapshot,
} = require("../src/simulation");

console.log("=== RUNNING 3D SIMULATION UNIT TESTS ===\n");

// TEST 1: World config exists
assert(typeof WORLD_CONFIG.moveSpeed === "number", "moveSpeed must be a number");
assert(typeof WORLD_CONFIG.simulationTickRate === "number", "tick rate must be a number");
assert(typeof WORLD_CONFIG.boundXZ === "number", "boundXZ must be a number");
console.log(`✓ World config: speed=${WORLD_CONFIG.moveSpeed}, tickRate=${WORLD_CONFIG.simulationTickRate}`);

// TEST 2: Player creation
const p1 = createPlayer("socket-1", "Alice", { x: 5, y: 2.5, z: 3 });
assert.strictEqual(p1.id,   "socket-1");
assert.strictEqual(p1.name, "Alice");
assert.strictEqual(p1.position.x, 5);
assert.strictEqual(p1.position.y, 2.5);
assert.strictEqual(p1.position.z, 3);
assert.strictEqual(p1.input.forward, 0);
assert.strictEqual(p1.input.strafe,  0);
console.log("✓ Player creation verified.");

// TEST 3: Public state never exposes internal input
const pub = getPublicPlayerState(p1);
assert.strictEqual(pub.id,   p1.id);
assert.strictEqual(pub.input, undefined, "input must NEVER be in public state");
// Mutating public state must NOT change internal state
pub.position.x = 999;
assert.strictEqual(p1.position.x, 5, "Internal position must not be mutable via public state");
console.log("✓ Public state encapsulation verified.");

// TEST 4: Input validation
assert.strictEqual(isValidMovementInput({ forward: 0,  strafe: 0,  yaw: 0 }),    true);
assert.strictEqual(isValidMovementInput({ forward: 1,  strafe: 0,  yaw: 1.57 }), true);
assert.strictEqual(isValidMovementInput({ forward: -1, strafe: 1,  yaw: -3.14 }),true);

// Invalid inputs
assert.strictEqual(isValidMovementInput(null),                           false, "null rejected");
assert.strictEqual(isValidMovementInput(undefined),                      false, "undefined rejected");
assert.strictEqual(isValidMovementInput({}),                             false, "empty object rejected");
assert.strictEqual(isValidMovementInput({ forward: 2, strafe: 0, yaw: 0 }),  false, "forward > 1 rejected");
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 2, yaw: 0 }),  false, "strafe > 1 rejected");
assert.strictEqual(isValidMovementInput({ forward: NaN, strafe: 0, yaw: 0 }),false, "NaN rejected");
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: Infinity, yaw: 0 }), false, "Infinity rejected");
// Coordinate injection attempt
assert.strictEqual(isValidMovementInput({ forward: 0, strafe: 0, yaw: 0, position: { x: 999 } }), true,
    "Extra fields accepted (only forward/strafe/yaw are used)");
console.log("✓ Input validation verified.");

// TEST 5: Movement actually moves the player
// updatePlayerPosition caps delta time at 0.1s internally, so we call it 10 times
// to simulate 1 real second (10 × 0.1s = 1s).
// Three.js convention: yaw=0 faces -Z direction, so forward goes along -Z.
const pMove = createPlayer("p-move", "Mover", { x: 0, y: 2.5, z: 0 });
// Face forward (yaw=0 → moving forward goes along -Z axis in Three.js)
setPlayerMovementInput(pMove, { forward: 1, strafe: 0, yaw: 0 });
// Simulate 10 ticks of 0.1s each = 1 second total
for (let i = 0; i < 10; i++) updatePlayerPosition(pMove, 0.1);
// Should have moved moveSpeed * 1.0 units along -Z
const expectedZ = -WORLD_CONFIG.moveSpeed * 1.0;
assert(
    Math.abs(pMove.position.z - expectedZ) < 0.01,
    `Expected z≈${expectedZ}, got ${pMove.position.z}`
);
// Y must remain fixed
assert.strictEqual(pMove.position.y, WORLD_CONFIG.defaultY, "Y must stay fixed (no gravity)");
console.log(`✓ Forward movement: moved ${pMove.position.z.toFixed(2)} units in z in 1s.`);

// TEST 6: World XZ boundary clamping
// At yaw=0 (facing -Z), strafe right goes in +X direction.
const pClamp = createPlayer("p-clamp", "Clamp", { x: 29, y: 2.5, z: 0 });
setPlayerMovementInput(pClamp, { forward: 0, strafe: 1, yaw: 0 }); // strafe right → +X direction with yaw=0
for (let i = 0; i < 300; i++) {
    updatePlayerPosition(pClamp, 1 / 30);
}
const b = WORLD_CONFIG.boundXZ;
assert(pClamp.position.x <= b, `x must not exceed ${b}`);
assert(pClamp.position.z <= b, `z must not exceed ${b}`);
console.log(`✓ XZ boundary clamping verified (bound: ±${b}).`);

// TEST 7: Diagonal speed normalization (10 × 0.1s ticks = 1 real second)
const pDiag = createPlayer("p-diag", "Diag", { x: 0, y: 2.5, z: 0 });
setPlayerMovementInput(pDiag, { forward: 1, strafe: 1, yaw: 0 });
for (let i = 0; i < 10; i++) updatePlayerPosition(pDiag, 0.1);
const diagDist = Math.hypot(pDiag.position.x - 0, pDiag.position.z - 0);
// Diagonal should travel same distance as straight (moveSpeed × 1s units)
assert(
    Math.abs(diagDist - WORLD_CONFIG.moveSpeed) < 0.1,
    `Diagonal distance should be ≈${WORLD_CONFIG.moveSpeed}, got ${diagDist.toFixed(4)}`
);
console.log(`✓ Diagonal normalization: dist = ${diagDist.toFixed(4)} (expected ≈${WORLD_CONFIG.moveSpeed}).`);

// TEST 8: Snapshot structure
const pA = createPlayer("sA", "PlayerA", { x: 1, y: 2.5, z: 2 });
const pB = createPlayer("sB", "PlayerB", { x: 3, y: 2.5, z: 4 });
const snap = createSnapshot([pA, pB]);
assert(typeof snap.timestamp === "number",    "snapshot has timestamp");
assert(Array.isArray(snap.players),           "snapshot has players array");
assert.strictEqual(snap.players.length, 2,   "snapshot has 2 players");
assert.strictEqual(snap.players[0].id, "sA", "first player id correct");
assert(typeof snap.players[0].yaw === "number", "yaw present in snapshot");
console.log("✓ Snapshot structure verified.");

console.log("\nALL TESTS PASSED ✓✓✓\n");
