// db.js — Stubbed Prisma client for offline development.
// Provides in-memory models for user, friendship, and block used by the server.
// Blocks are stored in memory so the seeded world actually persists during the session.

// Dummy user data for authentication and profile endpoints.
const dummyUser = {
  id: "dev-user",
  displayName: "Dev Player",
  avatar: null,
  showWorldToFriends: false,
  lastActive: new Date(),
  posX: 0,
  posY: 5,
  posZ: 0,
  recentBlocks: [],
  googleId: null,
};

// In-memory block storage so seeded/placed blocks actually persist.
const blockStore = new Map();
let blockIdCounter = 1;
function nextBlockId() {
  return `block-${blockIdCounter++}`;
}
function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

const prisma = {
  // User model operations.
  user: {
    findUnique: async ({ where }) => ({ ...dummyUser, ...where }),
    findFirst: async () => null,
    findMany: async () => [dummyUser],
    create: async ({ data }) => ({ ...dummyUser, ...data }),
    update: async ({ where, data }) => ({ ...dummyUser, ...where, ...data }),
  },
  // Friendship model – only read operations needed.
  friendship: {
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
  },
  // Block model – in-memory storage that actually persists blocks.
  block: {
    // Bulk create used during initial world seeding.
    createMany: async ({ data }) => {
      for (const b of data) {
        const id = nextBlockId();
        const block = { ...b, id };
        blockStore.set(blockKey(b.x, b.y, b.z), block);
      }
      return { count: data.length };
    },
    // Retrieve all blocks from in-memory store.
    findMany: async () => Array.from(blockStore.values()),
    // Create a single block.
    create: async ({ data }) => {
      const id = nextBlockId();
      const block = { ...data, id };
      blockStore.set(blockKey(data.x, data.y, data.z), block);
      return block;
    },
    // Delete a block by its id.
    delete: async ({ where }) => {
      for (const [key, block] of blockStore) {
        if (block.id === where.id) {
          blockStore.delete(key);
          return block;
        }
      }
      return { id: where.id };
    },
  },
};

module.exports = prisma;
