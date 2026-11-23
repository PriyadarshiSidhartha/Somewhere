// test-profile-friends.js — Unit tests for profile and friends system logic
const assert = require("assert");

console.log("\n=== RUNNING PROFILE & FRIENDS SYSTEM UNIT TESTS ===\n");

// 1. Username validation logic
function validateUsername(username) {
    if (typeof username !== "string") {
        return { valid: false, error: "Username must be a string." };
    }
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
        return { valid: false, error: "Username must be between 3 and 20 characters." };
    }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
        return { valid: false, error: "Username can only contain letters, numbers, spaces, underscores, and hyphens." };
    }
    return { valid: true, sanitized: trimmed };
}

assert.strictEqual(validateUsername("Alice").valid, true);
assert.strictEqual(validateUsername("Player_123").valid, true);
assert.strictEqual(validateUsername("Cool-Builder").valid, true);
assert.strictEqual(validateUsername("Bob The Builder").valid, true);
assert.strictEqual(validateUsername("ab").valid, false, "Too short");
assert.strictEqual(validateUsername("a".repeat(21)).valid, false, "Too long");
assert.strictEqual(validateUsername("hacker<script>").valid, false, "Disallowed characters");
assert.strictEqual(validateUsername("user@name!").valid, false, "Disallowed characters");
console.log("✓ Username validation and sanitization verified.");

// 2. Avatar validation logic
function validateAvatar(avatar) {
    if (avatar === null || avatar === "") return { valid: true, avatar: null };
    if (typeof avatar !== "string") return { valid: false, error: "Invalid type." };
    if (avatar.length > 3 * 1024 * 1024) return { valid: false, error: "Too large." };
    if (!avatar.startsWith("data:image/") && !avatar.startsWith("http://") && !avatar.startsWith("https://")) {
        return { valid: false, error: "Invalid format." };
    }
    return { valid: true, avatar };
}

assert.strictEqual(validateAvatar(null).valid, true);
assert.strictEqual(validateAvatar("https://example.com/pic.png").valid, true);
assert.strictEqual(validateAvatar("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==").valid, true);
assert.strictEqual(validateAvatar("data:text/html;base64,PHNjcmlwdD4=").valid, false, "Not an image");
assert.strictEqual(validateAvatar("a".repeat(4 * 1024 * 1024)).valid, false, "Oversized avatar");
console.log("✓ Avatar format and size validation verified.");

// 3. Location privacy rule: Server never exposes world if toggle is OFF or player is OFFLINE
function resolveFriendWorld(friend, isOnline, currentWorldName) {
    if (!isOnline) return null;
    if (friend.showWorldToFriends !== true) return null;
    return currentWorldName;
}

const CURRENT_WORLD = "Somewhere";

// Case A: Online, toggle ON -> reveals world
assert.strictEqual(resolveFriendWorld({ showWorldToFriends: true }, true, CURRENT_WORLD), "Somewhere");

// Case B: Online, toggle OFF (default) -> strictly null (no leak)
assert.strictEqual(resolveFriendWorld({ showWorldToFriends: false }, true, CURRENT_WORLD), null);

// Case C: Offline, toggle ON -> strictly null (no leak while offline)
assert.strictEqual(resolveFriendWorld({ showWorldToFriends: true }, false, CURRENT_WORLD), null);

// Case D: Offline, toggle OFF -> strictly null
assert.strictEqual(resolveFriendWorld({ showWorldToFriends: false }, false, CURRENT_WORLD), null);

console.log("✓ Location privacy strictly enforced (no world leaks when offline or privacy disabled).");

// 4. Relative time formatting
function formatRelativeTime(date) {
    if (!date) return "a while ago";
    const past = new Date(date).getTime();
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - past) / 1000));
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return "yesterday";
    return `${diffDays}d ago`;
}

const now = Date.now();
assert.strictEqual(formatRelativeTime(new Date(now - 10 * 1000)), "just now");
assert.strictEqual(formatRelativeTime(new Date(now - 5 * 60 * 1000)), "5m ago");
assert.strictEqual(formatRelativeTime(new Date(now - 3 * 3600 * 1000)), "3h ago");
assert.strictEqual(formatRelativeTime(new Date(now - 28 * 3600 * 1000)), "yesterday");
assert.strictEqual(formatRelativeTime(new Date(now - 3 * 86400 * 1000)), "3d ago");
console.log("✓ Relative time formatting verified.");

// 5. Friendship constraints
function validateFriendAddition(currentUserId, targetUser, existingFriendships) {
    if (!targetUser) return { ok: false, error: "User not found." };
    if (targetUser.id === currentUserId) return { ok: false, error: "You cannot add yourself as a friend." };

    const isAlreadyFriend = existingFriendships.some(
        (f) =>
            (f.userId === currentUserId && f.friendId === targetUser.id) ||
            (f.userId === targetUser.id && f.friendId === currentUserId)
    );
    if (isAlreadyFriend) return { ok: false, error: "Already friends." };

    return { ok: true };
}

const userA = { id: "user_a" };
const userB = { id: "user_b" };
const existing = [{ userId: "user_a", friendId: "user_b" }];

assert.strictEqual(validateFriendAddition("user_a", null, []).ok, false);
assert.strictEqual(validateFriendAddition("user_a", userA, []).ok, false, "Self-add prevented");
assert.strictEqual(validateFriendAddition("user_a", userB, existing).ok, false, "Duplicate friendship prevented");
assert.strictEqual(validateFriendAddition("user_a", { id: "user_c" }, existing).ok, true);
console.log("✓ Friendship relationship constraints verified.");

console.log("\nALL PROFILE & FRIENDS TESTS PASSED ✓✓✓\n");
