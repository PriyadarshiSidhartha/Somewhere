# Somewhere

A persistent multiplayer 3D block game built with **Three.js, Node.js, Express, Socket.IO, Prisma, MongoDB, and Google OAuth**.

---

## 🛠️ Tech Stack

- **Frontend**: Three.js (PointerLockControls, custom voxel geometry, Lambert shading)
- **Backend**: Node.js & Express
- **Networking**: Socket.IO (Server-authoritative movement & block synchronization)
- **Database**: MongoDB (via MongoDB Atlas)
- **ORM**: Prisma (MongoDB connector)
- **Authentication**: Google OAuth 2.0 via Passport.js & Express Session (MongoDB session store)

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Node.js (v18+)
- MongoDB Atlas cluster
- Google Cloud Console OAuth 2.0 Credentials

### 2. Configure Environment Variables
Inside `server/.env`:

```env
DATABASE_URL="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/somewhere?retryWrites=true&w=majority"
GOOGLE_CLIENT_ID="<your-google-client-id>"
GOOGLE_CLIENT_SECRET="<your-google-client-secret>"
SESSION_SECRET="your-long-random-secret-key"
PORT=3000
```

> **Note**: `.env` is ignored by Git and will never be committed.

### 3. Install & Initialize Database
```bash
cd server
npm install
npx prisma generate
npx prisma db push
```

### 4. Run Unit Tests
```bash
npm test
```

### 5. Start the Server
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser!

---

## 🎮 Controls

| Action | Control |
|---|---|
| **Move** | `W`, `A`, `S`, `D` |
| **Look Around** | Mouse |
| **Remove Block** | Left Click |
| **Place Block** | Right Click |
| **Capture / Release Cursor** | Click to Play / `Escape` |
| **Chat** | `Enter` to focus, type message, `Enter` to send |

---

## 👥 Team Work Division

- **Member 1 (Backend & Server)**: Express setup, Socket.IO event loops, server-authoritative movement simulation (`simulation.js`, `server.js`).
- **Member 2 (Three.js & Frontend)**: 3D scene, first-person camera, lighting, crosshair, HUD, client prediction (`public/index.html`).
- **Member 3 (Multiplayer & Blocks)**: Raycasting block selection, real-time block placement/removal sync, player representations (`worldState.js`, `server.js`).
- **Member 4 (Database & Auth)**: Prisma schema, MongoDB persistence, Google OAuth login flow, session management (`auth.js`, `db.js`, `schema.prisma`).
