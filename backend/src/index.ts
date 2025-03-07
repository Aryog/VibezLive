import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as mediasoup from 'mediasoup';
import { Room } from './room';

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

      // Send router RTP capabilities
      const routerRtpCapabilities = await room.getRtpCapabilities();
      socket.emit('routerCapabilities', { routerRtpCapabilities });

      // Get list of current producers
      const producerIds = room.getProducerIds();
      socket.emit('currentProducers', { producerIds });

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
      callback({ error: error.message });
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

  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      const producerId = await room.produce(socket.id, kind, rtpParameters);

      // Notify all peers in the room about new producer
      socket.to(roomId).emit('newProducer', { producerId });

      callback({ producerId });
    } catch (error) {
      console.error('Error producing:', error);
      callback({ error: error.message });
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
      callback({ error: error.message });
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
    const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.closeProducer(socket.id);
        room.closeConsumers(socket.id);
        room.closeTransport(socket.id);
        socket.to(roomId).emit('peerLeft', { peerId: socket.id });
      }
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
