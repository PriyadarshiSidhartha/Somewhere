// test-network-protocol.js — Tests for movement input protocol security.
//
// Updated for the physics-based simulation system.
// Run with: node test/test-network-protocol.js

const assert = require("assert");
const {
    WORLD_CONFIG,
    PHYSICS_CONFIG,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    simulateTick,
    createSnapshot,
    setWorldCollisionFn,
} = require("../src/simulation");

// Set up collision world (flat floor at y=0).
function testIsSolidAt(x, y, z) {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    return by === 0 && bx >= -10 && bx < 10 && Math.floor(z) >= -10 && Math.floor(z) < 10;
}
setWorldCollisionFn(testIsSolidAt);

console.log("=== RUNNING NETWORK PROTOCOL & SECURITY TESTS ===\n");

// 1. Public state never leaks internal fields
const p = createPlayer("socket_abc123", "Player-Test", { x: 0, y: 2.5, z: 0 });
const pub = getPublicPlayerState(p);
assert.strictEqual(pub.id, "socket_abc123");
assert.strictEqual(pub.name, "Player-Test");
assert.strictEqual(pub.input, undefined, "Internal input MUST NOT be exposed");
assert.deepStrictEqual(pub.position, { x: 0, y: 2.5, z: 0 });
console.log("✓ Public state does not expose internal input.");

// 2. Only valid direction inputs are accepted
const validInputs = [
    { forward: 0, strafe: 0, yaw: 0 },
    { forward: 1, strafe: 0, yaw: 1.57 },
    { forward: -1, strafe: 1, yaw: -3.14 },
    { forward: 0, strafe: -1, yaw: 6.28 },
    { forward: 0, strafe: 0, yaw: 0, seq: 0 },
    { forward: 0, strafe: 0, yaw: 0, seq: 100, jump: true },
];
for (const input of validInputs) {
    assert.strictEqual(isValidMovementInput(input), true, `Valid input rejected: ${JSON.stringify(input)}`);
}

// Malicious/malformed payloads that MUST be rejected
const badInputs = [
    null, undefined, "wasd", 42, [],
    {},
    { forward: 1 },                                     // missing strafe + yaw
    { forward: 2, strafe: 0, yaw: 0 },               // forward > 1
    { forward: 0, strafe: -2, yaw: 0 },               // strafe < -1
    { forward: NaN, strafe: 0, yaw: 0 },               // NaN
    { forward: 0, strafe: 0, yaw: Infinity },        // infinite yaw
    { forward: 0, strafe: 0, yaw: 0, seq: -1 },     // negative seq
    { forward: 0, strafe: 0, yaw: 0, seq: 1.5 },    // non-integer seq
    // Coordinate injection attempts
    { forward: 0, strafe: 0, yaw: 0, x: 999, z: 999 }, // should be valid (extra fields ignored)
];

// Everything up to the last one must be invalid
for (const input of badInputs.slice(0, -1)) {
    assert.strictEqual(
        isValidMovementInput(input),
        false,
        `Bad input was not rejected: ${JSON.stringify(input)}`
    );
}
// The last entry has valid forward/strafe/yaw — extra fields are ignored
assert.strictEqual(isValidMovementInput(badInputs[badInputs.length - 1]), true);

console.log("✓ Invalid/malicious inputs correctly rejected.");

// 3. setPlayerMovementInput does NOT touch player.position
const pSec = createPlayer("p-sec", "SecTest", { x: 0, y: 2.5, z: 0 });
const malicious = { forward: 0, strafe: 0, yaw: 0, position: { x: 999, y: 999, z: 999 } };
setPlayerMovementInput(pSec, malicious);
assert.strictEqual(pSec.position.x, 0, "Position x must not be modified by input");
assert.strictEqual(pSec.position.z, 0, "Position z must not be modified by input");
console.log("✓ Coordinate injection via input payload rejected.");

// 4. simulateTick caps excessive delta time (accumulator capped at 0.25s)
const pStall = createPlayer("p-stall", "Stall", { x: 0, y: 5, z: 0 });
// Settle onto ground first
for (let i = 0; i < 120; i++) simulateTick([pStall], 1 / 60);
setPlayerMovementInput(pStall, { forward: 1, strafe: 0, yaw: 0, seq: 0 });
const stallStartZ = pStall.position.z;
simulateTick([pStall], 10.0); // simulate a 10-second stall
const stallMoved = Math.abs(pStall.position.z - stallStartZ);
// With 0.25s accumulator cap, max movement = 0.25 * moveSpeed
const maxMovement = 0.25 * PHYSICS_CONFIG.moveSpeed;
assert(
    stallMoved <= maxMovement + 1.0,
    `Stall should be capped near ${maxMovement} units, got ${stallMoved.toFixed(2)}`
);
console.log(`✓ Delta time capping: moved ${stallMoved.toFixed(2)} units (max ~${maxMovement}).`);

// 5. Snapshot correctness
const pX = createPlayer("px", "X", { x: 5, y: 2.5, z: 10 });
const pY = createPlayer("py", "Y", { x: -3, y: 2.5, z: 7 });
const snap = createSnapshot([pX, pY]);
assert(typeof snap.timestamp === "number");
assert.strictEqual(snap.players.length, 2);
const snapX = snap.players.find(s => s.id === "px");
assert(snapX, "Player px must be in snapshot");
assert.strictEqual(snapX.position.x, 5);
assert.strictEqual(snapX.position.z, 10);
// Snapshot includes new physics fields
assert(typeof snapX.velocity === "object", "velocity in snapshot");
assert(typeof snapX.grounded === "boolean", "grounded in snapshot");
assert(typeof snapX.lastProcessedSeq === "number", "lastProcessedSeq in snapshot");
console.log("✓ Snapshot serialization correct.");

console.log("\nALL TESTS PASSED ✓✓✓\n");
