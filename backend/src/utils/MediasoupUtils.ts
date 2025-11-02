import * as mediasoup from 'mediasoup';
import { Server, Socket } from 'socket.io';
import { Room } from '../room.js';
import {
  RoomHandlers,
  TransportHandlers,
  ProducerHandlers,
  ConsumerHandlers,
  PeerHandlers
} from '../handlers/index.js';

export class MediasoupUtils {
  private worker!: mediasoup.types.Worker;
  private rooms: Map<string, Room>;
  private userRooms: Map<string, string>;
  private io: Server;
  
  // Modular handlers
  private roomHandlers: RoomHandlers;
  private transportHandlers: TransportHandlers;
  private producerHandlers: ProducerHandlers;
  private consumerHandlers: ConsumerHandlers;
  private peerHandlers: PeerHandlers;

  constructor(io: Server) {
    this.rooms = new Map();
    this.userRooms = new Map();
    this.io = io;
    
    // Initialize handlers
    this.roomHandlers = new RoomHandlers(this.rooms, this.userRooms);
    this.transportHandlers = new TransportHandlers();
    this.producerHandlers = new ProducerHandlers();
    this.consumerHandlers = new ConsumerHandlers();
    this.peerHandlers = new PeerHandlers(this.io, this.rooms, this.userRooms);
  }

  async initializeWorker() {
    const { config } = await import('../config/mediasoup.config.js');
    
    this.worker = await mediasoup.createWorker({
      logLevel: config.worker.logLevel,
      rtcMinPort: config.worker.rtcMinPort,
      rtcMaxPort: config.worker.rtcMaxPort,
    });

    console.log(`mediasoup worker created [pid:${this.worker.pid}]`);

    this.worker.on('died', () => {
      console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', this.worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });
  }

  handleConnection(socket: Socket) {
    console.log('client connected', socket.id);

    // Room events
    socket.on('joinRoom', async ({ roomId }) => {
      await this.roomHandlers.handleJoinRoom(socket, { roomId }, this.worker);
    });

    // Transport events
    socket.on('createWebRtcTransport', async ({ sender }, callback) => {
      const roomId = this.roomHandlers.getRoomId(socket);
      if (!roomId) {
        console.error('Room not found for socket', socket.id);
        return;
      }

      const room = this.roomHandlers.getRoom(roomId);
      if (!room) {
        console.error('Room instance not found', roomId);
        return;
      }

      await this.transportHandlers.handleCreateWebRtcTransport(socket, { sender }, callback, room);
    });

    socket.on('connectTransport', async ({ dtlsParameters, sender }) => {
      const roomId = this.roomHandlers.getRoomId(socket);
      if (!roomId) return;

      const room = this.roomHandlers.getRoom(roomId);
      if (!room) return;

      await this.transportHandlers.handleConnectTransport(socket, { dtlsParameters, sender }, room);
    });

    // Producer events
    socket.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
      const roomId = this.roomHandlers.getRoomId(socket);
      if (!roomId) return;

      const room = this.roomHandlers.getRoom(roomId);
      if (!room) return;

      await this.producerHandlers.handleProduce(socket, { kind, rtpParameters, appData }, callback, room, roomId);
    });

    socket.on('closeProducer', async ({ producerId }) => {
      const roomId = this.roomHandlers.getRoomId(socket);
      if (!roomId) return;

      const room = this.roomHandlers.getRoom(roomId);
      if (!room) return;

      await this.producerHandlers.handleCloseProducer(socket, { producerId }, room, roomId);
    });

    // Consumer events
    socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
      const roomId = this.roomHandlers.getRoomId(socket);
      if (!roomId) return;

      const room = this.roomHandlers.getRoom(roomId);
      if (!room) return;

      await this.consumerHandlers.handleConsume(socket, { producerId, rtpCapabilities }, callback, room);
    });

    socket.on('resumeConsumer', async ({ consumerId }) => {
      const roomId = this.roomHandlers.getRoomId(socket);
      if (!roomId) return;

      const room = this.roomHandlers.getRoom(roomId);
      if (!room) return;

      await this.consumerHandlers.handleResumeConsumer(socket, { consumerId }, room);
    });

    // Peer events
    socket.on('disconnect', () => {
      this.peerHandlers.handleDisconnect(socket);
    });

    socket.on('kickPeer', async ({ peerId, roomId }) => {
      await this.peerHandlers.handleKickPeer(socket, { peerId, roomId });
    });

    socket.on('requestSync', async ({ peerId }) => {
      this.peerHandlers.handleRequestSync(socket, { peerId });
    });
  }
}