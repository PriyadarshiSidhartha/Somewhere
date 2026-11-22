// db.js — Prisma client singleton.
//
// We create ONE PrismaClient and reuse it everywhere.

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = prisma;
