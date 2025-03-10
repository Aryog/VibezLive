import * as mediasoup from 'mediasoup';
import { Server, Socket } from 'socket.io';
import { Room } from '../room.js';

export class MediasoupUtils {
  private worker!: mediasoup.types.Worker;
  private rooms: Map<string, Room>;
  private userRooms: Map<string, string>;
  private io: Server;

  constructor(io: Server) {
    this.rooms = new Map();
    this.userRooms = new Map();
    this.io = io;
  }

  async initializeWorker() {
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    console.log('mediasoup worker created');

    this.worker.on('died', () => {
      console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', this.worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });
  }

  private async disconnectPeerFromRoom(socketId: string, roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    console.log(`Forcefully disconnecting peer ${socketId} from room ${roomId}`);
    
    room.disconnectPeer(socketId);
    
    this.io.to(roomId).emit('peerLeft', { peerId: socketId });
    
    if (room.isEmpty()) {
      console.log(`Room ${roomId} is empty, closing and removing it`);
      room.close();
      this.rooms.delete(roomId);
    }
  }

  handleConnection(socket: Socket) {
    console.log('client connected', socket.id);

    socket.on('joinRoom', async ({ roomId }) => {
      try {
        if (!this.rooms.has(roomId)) {
          const room = new Room(roomId, this.worker);
          this.rooms.set(roomId, room);
        }

        const room = this.rooms.get(roomId)!;
        socket.join(roomId);
        
        this.userRooms.set(socket.id, roomId);

        const routerRtpCapabilities = await room.getRtpCapabilities();
        socket.emit('routerCapabilities', { routerRtpCapabilities });

        const producers = room.getProducersInfo();
        socket.emit('currentProducers', { producers });

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

        const room = this.rooms.get(roomId);
        if (!room) {
          console.error('Room instance not found', roomId);
          return;
        }

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

        const room = this.rooms.get(roomId);
        if (!room) return;

        await room.connectTransport(socket.id, dtlsParameters, sender);
      } catch (error) {
        console.error('Error connecting transport:', error);
      }
    });

    socket.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
      try {
        const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        const producerId = await room.produce(socket.id, kind, rtpParameters, appData);

        socket.to(roomId).emit('newProducer', { 
          producerId,
          peerId: socket.id,
          kind,
          appData
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

        const room = this.rooms.get(roomId);
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

        const room = this.rooms.get(roomId);
        if (!room) return;

        await room.resumeConsumer(socket.id, consumerId);
      } catch (error) {
        console.error('Error resuming consumer:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log('client disconnected', socket.id);
      
      const roomId = this.userRooms.get(socket.id);
      if (roomId) {
        const room = this.rooms.get(roomId);
        if (room) {
          console.log(`Cleaning up resources for peer ${socket.id} in room ${roomId}`);
          
          room.disconnectPeer(socket.id);
          
          this.io.to(roomId).emit('peerLeft', { 
            peerId: socket.id 
          });
          
          if (room.isEmpty()) {
            console.log(`Room ${roomId} is empty, closing and removing it`);
            room.close();
            this.rooms.delete(roomId);
          }
        }
        
        this.userRooms.delete(socket.id);
      }
    });

    socket.on('kickPeer', async ({ peerId, roomId }) => {
      try {
        const room = this.rooms.get(roomId);
        if (!room) {
          console.log(`Room ${roomId} not found`);
          return;
        }

        await this.disconnectPeerFromRoom(peerId, roomId);
        
        const peerSocket = this.io.sockets.sockets.get(peerId);
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

        const room = this.rooms.get(roomId);
        if (!room) return;

        room.closeSpecificProducer(producerId);
        
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

        const targetSocket = this.io.sockets.sockets.get(peerId);
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
  }
}