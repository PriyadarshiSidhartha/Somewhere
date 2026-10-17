const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        name: "Somewhere"
    });
});

io.on("connection", (socket) => {
    const playerId = socket.id;

    console.log(`Player connected: ${playerId}`);

    // Welcome the newly connected player
    socket.emit("welcome", {
        playerId: playerId,
        message: "Welcome to Somewhere!"
    });

    // Handle a test message from the client
    socket.on("ping_server", (data) => {
        console.log(`Message from ${playerId}:`, data);

        socket.emit("pong_server", {
            message: "Message received!",
            received: data
        });
    });

    socket.on("disconnect", () => {
        console.log(`Player disconnected: ${playerId}`);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Somewhere server running on port ${PORT}`);
});