const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Initialize Express and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the frontend static files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io Signaling Logic
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Sender creates a new room
    socket.on('create-room', (roomCode) => {
        socket.join(roomCode);
        console.log(`Room created: ${roomCode}`);
    });

    // Receiver joins the room
    socket.on('join-room', (roomCode) => {
        const room = io.sockets.adapter.rooms.get(roomCode);
        
        if (room && room.size > 0) {
            socket.join(roomCode);
            console.log(`User ${socket.id} joined room: ${roomCode}`);
            // Notify the sender that the receiver has joined so they can generate the WebRTC offer
            socket.to(roomCode).emit('user-joined');
        } else {
            socket.emit('error', 'Room does not exist.');
        }
    });

    // Relay WebRTC Offer
    socket.on('offer', ({ roomCode, offer }) => {
        socket.to(roomCode).emit('offer', offer);
    });

    // Relay WebRTC Answer
    socket.on('answer', ({ roomCode, answer }) => {
        socket.to(roomCode).emit('answer', answer);
    });

    // Relay ICE Candidates (Network routing info)
    socket.on('ice-candidate', ({ roomCode, candidate }) => {
        socket.to(roomCode).emit('ice-candidate', candidate);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Start the server on all network interfaces (0.0.0.0)
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`QuikShare signaling server running on port ${PORT}`);
    console.log(`Local testing: http://localhost:${PORT}`);
});