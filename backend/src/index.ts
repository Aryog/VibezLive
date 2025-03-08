import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as mediasoup from 'mediasoup';
import { Room } from './room.js';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Global variables
let worker: mediasoup.types.Worker;
const rooms = new Map<string, Room>();
const userRooms = new Map<string, string>(); // Maps socketId -> roomId

async function runMediasoupWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
  });

  console.log('mediasoup worker created');

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });
}

const disconnectPeerFromRoom = async (socketId: string, roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) return;

  console.log(`Forcefully disconnecting peer ${socketId} from room ${roomId}`);
  
  // Clean up all resources for this peer
  room.disconnectPeer(socketId);
  
  // Notify all peers in the room about the disconnection
  io.to(roomId).emit('peerLeft', { 
    peerId: socketId 
  });
  
  // If the room is empty after this peer leaves, clean it up
  if (room.isEmpty()) {
    console.log(`Room ${roomId} is empty, closing and removing it`);
    room.close();
    rooms.delete(roomId);
  }
};

io.on('connection', async (socket) => {
  console.log('client connected', socket.id);

  socket.on('joinRoom', async ({ roomId }) => {
    try {
      if (!rooms.has(roomId)) {
        const room = new Room(roomId, worker);
        rooms.set(roomId, room);
      }

      const room = rooms.get(roomId)!;
      socket.join(roomId);
      
      // Track the user's room
      userRooms.set(socket.id, roomId);

      // Send router RTP capabilities
      const routerRtpCapabilities = await room.getRtpCapabilities();
      socket.emit('routerCapabilities', { routerRtpCapabilities });

      // Get list of current producers with their peer IDs
      const producers = room.getProducersInfo();
      socket.emit('currentProducers', { producers });

      // Notify other peers
      socket.to(roomId).emit('newPeer', { peerId: socket.id });
    } catch (error) {
      console.error('Error joining room:', error);
    }
  });

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) {
        console.error('Room not found for socket', socket.id);
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        console.error('Room instance not found', roomId);
        return;
      }

      // Pass the sender flag to differentiate between transport types
      const transport = await room.createWebRtcTransport(socket.id, sender);
      callback({ params: transport });
    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      callback({ error: error instanceof Error ? error.message : 'Unknown transport error' });
    }
  });

  socket.on('connectTransport', async ({ dtlsParameters, sender }) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      // Pass the sender flag to connect the correct transport
      await room.connectTransport(socket.id, dtlsParameters, sender);
    } catch (error) {
      console.error('Error connecting transport:', error);
    }
  });

  socket.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      const producerId = await room.produce(socket.id, kind, rtpParameters, appData);

      // Notify all peers in the room about new producer
      socket.to(roomId).emit('newProducer', { 
        producerId,
        peerId: socket.id,
        kind,
        appData // Pass the appData to identify screen shares
      });

      callback({ producerId });
    } catch (error) {
      console.error('Error producing:', error);
      callback({ error: error instanceof Error ? error.message : 'Unknown producer error' });
    }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      const params = await room.consume(socket.id, producerId, rtpCapabilities);
      callback({ params });
    } catch (error) {
      console.error('Error consuming:', error);
      callback({ error: error instanceof Error ? error.message : 'Unknown consumer error' });
    }
  });

  socket.on('resumeConsumer', async ({ consumerId }) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      await room.resumeConsumer(socket.id, consumerId);
    } catch (error) {
      console.error('Error resuming consumer:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('client disconnected', socket.id);
    
    // Get the room from our tracking map
    const roomId = userRooms.get(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        console.log(`Cleaning up resources for peer ${socket.id} in room ${roomId}`);
        
        // Clean up all resources for this peer
        room.disconnectPeer(socket.id);
        
        // Notify all peers in the room about the disconnection
        io.to(roomId).emit('peerLeft', { 
          peerId: socket.id 
        });
        
        // If the room is empty after this peer leaves, clean it up
        if (room.isEmpty()) {
          console.log(`Room ${roomId} is empty, closing and removing it`);
          room.close();
          rooms.delete(roomId);
        }
      }
      
      // Remove the user from our tracking
      userRooms.delete(socket.id);
    }
  });

  socket.on('kickPeer', async ({ peerId, roomId }) => {
    try {
      // Verify the room exists
      const room = rooms.get(roomId);
      if (!room) {
        console.log(`Room ${roomId} not found`);
        return;
      }

      // Disconnect the peer
      await disconnectPeerFromRoom(peerId, roomId);
      
      // Force disconnect their socket
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket) {
        peerSocket.disconnect(true);
      }

    } catch (error) {
      console.error('Error kicking peer:', error);
    }
  });

  socket.on('closeProducer', async ({ producerId }) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      // Close the specific producer
      room.closeSpecificProducer(producerId);
      
      // Notify other peers about the closed producer
      socket.to(roomId).emit('producerClosed', { producerId });
      
      console.log(`Producer ${producerId} closed by socket ${socket.id}`);
    } catch (error) {
      console.error('Error closing producer:', error);
    }
  });

  socket.on('requestSync', async ({ peerId }) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      // Find the target socket in the same room
      const targetSocket = io.sockets.sockets.get(peerId);
      if (targetSocket && targetSocket.rooms.has(roomId)) {
        console.log(`Requesting sync from peer ${peerId} for ${socket.id}`);
        targetSocket.emit('requestSync');
      } else {
        console.log(`Target peer ${peerId} not found or not in same room`);
      }
    } catch (error) {
      console.error('Error processing sync request:', error);
    }
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await runMediasoupWorker();

  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

start().catch(console.error);
