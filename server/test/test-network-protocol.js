// test-network-protocol.js — Tests for movement input protocol security.
//
// Run with: node test/test-network-protocol.js

const assert = require("assert");
const {
    WORLD_CONFIG,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    simulateTick,
    createSnapshot,
} = require("../src/simulation");

console.log("=== RUNNING NETWORK PROTOCOL & SECURITY TESTS ===\n");

// 1. Public state never leaks internal fields
const p = createPlayer("socket_abc123", "Player-Test", { x: 0, y: 2.5, z: 0 });
const pub = getPublicPlayerState(p);
assert.strictEqual(pub.id,     "socket_abc123");
assert.strictEqual(pub.name,   "Player-Test");
assert.strictEqual(pub.input,  undefined, "Internal input MUST NOT be exposed");
assert.deepStrictEqual(pub.position, { x: 0, y: 2.5, z: 0 });
console.log("✓ Public state does not expose internal input.");

// 2. Only valid direction inputs are accepted
const validInputs = [
    { forward: 0,  strafe: 0,  yaw: 0 },
    { forward: 1,  strafe: 0,  yaw: 1.57 },
    { forward: -1, strafe: 1,  yaw: -3.14 },
    { forward: 0,  strafe: -1, yaw: 6.28 },
];
for (const input of validInputs) {
    assert.strictEqual(isValidMovementInput(input), true, `Valid input rejected: ${JSON.stringify(input)}`);
}

// Malicious/malformed payloads that MUST be rejected
const badInputs = [
    null, undefined, "wasd", 42, [],
    {},
    { forward: 1 },                                     // missing strafe + yaw
    { forward: 2,  strafe: 0,  yaw: 0 },               // forward > 1
    { forward: 0,  strafe: -2, yaw: 0 },               // strafe < -1
    { forward: NaN, strafe: 0, yaw: 0 },               // NaN
    { forward: 0,  strafe: 0,  yaw: Infinity },        // infinite yaw
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
// The last entry has valid forward/strafe/yaw — extra fields are ignored (not a security issue since
// the server only reads forward, strafe, yaw from the input object)
assert.strictEqual(isValidMovementInput(badInputs[badInputs.length - 1]), true);

console.log("✓ Invalid/malicious inputs correctly rejected.");

// 3. setPlayerMovementInput does NOT touch player.position
const pSec = createPlayer("p-sec", "SecTest", { x: 0, y: 2.5, z: 0 });
const malicious = { forward: 0, strafe: 0, yaw: 0, position: { x: 999, y: 999, z: 999 } };
setPlayerMovementInput(pSec, malicious);
assert.strictEqual(pSec.position.x, 0,   "Position x must not be modified by input");
assert.strictEqual(pSec.position.z, 0,   "Position z must not be modified by input");
console.log("✓ Coordinate injection via input payload rejected.");

// 4. simulateTick caps excessive delta time
const pStall = createPlayer("p-stall", "Stall", { x: 0, y: 2.5, z: 0 });
setPlayerMovementInput(pStall, { forward: 1, strafe: 0, yaw: 0 });
simulateTick([pStall], 10.0); // simulate a 10-second stall
// With 0.1s cap, max movement = 0.1 * moveSpeed
const maxMovement = 0.1 * WORLD_CONFIG.moveSpeed;
assert(
    Math.abs(pStall.position.z) <= maxMovement + 0.01,
    `Stall should be capped at ${maxMovement} units, got ${pStall.position.z}`
);
console.log(`✓ Delta time capping: moved ${Math.abs(pStall.position.z).toFixed(2)} units (max ${maxMovement}).`);

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
console.log("✓ Snapshot serialization correct.");

console.log("\nALL TESTS PASSED ✓✓✓\n");
