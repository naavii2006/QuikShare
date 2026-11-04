// ---------------------------------------------------------
// PWA Service Worker Registration
// ---------------------------------------------------------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker Registered!', reg))
            .catch(err => console.error('Service Worker Registration Failed!', err));
    });
}

// ---------------------------------------------------------
// Core Variables
// ---------------------------------------------------------
let roomCode = null;
let selectedFile = null;
let connectionStatus = 'Idle'; 

// WebRTC & Network Variables
let peerConnection;
let dataChannel;
const socket = io(); 
const CHUNK_SIZE = 16 * 1024; 

// STUN Servers (Required for public internet connections)
const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// DOM Elements
const uiStatus = document.getElementById('connStatus');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('file-info');
const btnCreateRoom = document.getElementById('btn-create-room');
const displayRoomCode = document.getElementById('display-roomCode');
const qrContainer = document.getElementById('qr-container');
const btnSendFile = document.getElementById('btn-send-file');
const inputRoomCode = document.getElementById('input-roomCode');
const btnJoinRoom = document.getElementById('btn-join-room');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('download-progress');
const downloadLink = document.getElementById('download-link');

// ---------------------------------------------------------
// UI & Drag-and-Drop Logic
// ---------------------------------------------------------
function updateStatus(status) {
    connectionStatus = status;
    uiStatus.innerText = connectionStatus;
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        fileInfo.innerText = `Selected: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`;
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        selectedFile = fileInput.files[0];
        fileInfo.innerText = `Selected: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`;
    }
});

// ---------------------------------------------------------
// Signaling Logic (Socket.io) & QR Generation
// ---------------------------------------------------------
btnCreateRoom.addEventListener('click', () => {
    roomCode = Math.floor(100000 + Math.random() * 900000).toString(); 
    displayRoomCode.innerText = roomCode;
    
    // Create a direct join link for the QR Code
    // Make sure to access this site on local network IP (e.g. 192.168.x.x) to scan from mobile properly
    const joinLink = `${window.location.origin}/?room=${roomCode}`;
    
    qrContainer.innerHTML = ''; 
    qrContainer.style.display = 'flex';
    new QRCode(qrContainer, {
        text: joinLink,
        width: 150,
        height: 150,
        colorDark: "#1f2937",
        colorLight: "#ffffff",
    });

    socket.emit('create-room', roomCode);
    updateStatus('Waiting for receiver...');
    setupSenderWebRTC();
});

btnJoinRoom.addEventListener('click', () => {
    roomCode = inputRoomCode.value.trim();
    if (!roomCode) return alert('Please enter a room code');
    socket.emit('join-room', roomCode);
    updateStatus('Connecting...');
    setupReceiverWebRTC();
});

// Auto-join logic for QR code scanners
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const autoRoom = urlParams.get('room');
    
    if (autoRoom) {
        inputRoomCode.value = autoRoom;
        btnJoinRoom.click(); 
    }
});

// Signaling server listeners
socket.on('offer', async (offer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { roomCode, answer });
});

socket.on('answer', async (answer) => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', (candidate) => {
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

// ---------------------------------------------------------
// WebRTC & File Chunking Logic
// ---------------------------------------------------------
function setupSenderWebRTC() {
    peerConnection = new RTCPeerConnection(config);
    dataChannel = peerConnection.createDataChannel('fileTransfer');
    
    dataChannel.onopen = () => {
        updateStatus('Connected. Ready to send.');
        btnSendFile.disabled = false;
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { roomCode, candidate: e.candidate });
    };

    socket.on('user-joined', async () => {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomCode, offer });
    });
}

function setupReceiverWebRTC() {
    peerConnection = new RTCPeerConnection(config);
    let receivedBuffers = [];
    let receivedSize = 0;
    let fileMetadata = null;

    peerConnection.ondatachannel = (e) => {
        const receiveChannel = e.channel;
        receiveChannel.binaryType = 'arraybuffer';

        receiveChannel.onmessage = (event) => {
            if (typeof event.data === 'string') {
                fileMetadata = JSON.parse(event.data);
                updateStatus(`Receiving ${fileMetadata.name}...`);
            } else {
                receivedBuffers.push(event.data);
                receivedSize += event.data.byteLength;
                
                const percentage = Math.round((receivedSize / fileMetadata.size) * 100);
                progressBar.value = percentage;
                progressText.innerText = `${percentage}%`;

                if (receivedSize === fileMetadata.size) {
                    const blob = new Blob(receivedBuffers);
                    downloadLink.href = URL.createObjectURL(blob);
                    downloadLink.download = fileMetadata.name;
                    downloadLink.hidden = false;
                    downloadLink.click();
                    updateStatus('Transfer Complete');
                }
            }
        };
    };

    peerConnection.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-candidate', { roomCode, candidate: e.candidate });
    };
}

// Read file in chunks and send
btnSendFile.addEventListener('click', () => {
    if (!selectedFile) return alert('Select a file first!');
    
    // Send metadata first
    const metadata = { name: selectedFile.name, size: selectedFile.size };
    dataChannel.send(JSON.stringify(metadata));

    let offset = 0;
    const reader = new FileReader();

    reader.onload = (e) => {
        dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        if (offset < selectedFile.size) {
            readSlice(offset);
        } else {
            updateStatus('File Sent Successfully!');
        }
    };

    function readSlice(o) {
        const slice = selectedFile.slice(o, o + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
    }
    
    readSlice(0);
});
