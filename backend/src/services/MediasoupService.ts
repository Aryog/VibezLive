import * as mediasoup from 'mediasoup';
import { config } from '../config/mediasoup.config';
import { MediasoupWorker, Room, TransportAppData } from '../types/mediasoup';
import { types } from 'mediasoup';

export class MediasoupService {
  private static instance: MediasoupService;
  private workers: MediasoupWorker[] = [];
  private rooms: Map<string, Room> = new Map();
  private workerIndex = 0;
  private roomId: string | null = null;
  private peerId: string | null = null;

  constructor() {
    if (MediasoupService.instance) {
      return MediasoupService.instance;
    }
    MediasoupService.instance = this;
  }

  async init(numWorkers: number = 1) {
    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker(config.mediasoup.worker as types.WorkerSettings);
      const router = await worker.createRouter({ mediaCodecs: config.mediasoup.router.mediaCodecs as types.RtpCodecCapability[] });
      this.workers.push({ worker, router });
    }
  }

  async createRoom(roomId: string): Promise<Room> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    const worker = this.getNextWorker();
    const router = await worker.worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    });

    const room: Room = {
      id: roomId,
      router,
      producers: new Map(),
      consumers: new Map(),
      peers: new Map(),
    };

    this.rooms.set(roomId, room);
    this.notifyActiveUsers(roomId);
    return room;
  }

  async createWebRtcTransport(roomId: string, peerId: string, type: 'producer' | 'consumer') {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    const transport = await room.router.createWebRtcTransport({
      ...config.mediasoup.webRtcTransport,
      appData: {} as TransportAppData
    });

    if (!room.peers.has(peerId)) {
      room.peers.set(peerId, {
        id: peerId,
        username: '',
        isStreaming: false,
        transports: [],
      });
    }

    const peer = room.peers.get(peerId)!;
    peer.transports.push({
      transport,
      type,
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  private getNextWorker(): MediasoupWorker {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }

  // Add methods for handling producers
  async createProducer(roomId: string, peerId: string, transportId: string, kind: string, rtpParameters: any) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found in room ${roomId}`);

    const transport = peer.transports.find(t => t.transport.id === transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found for peer ${peerId}`);

    console.log('Creating producer:', { roomId, peerId, transportId, kind });
    const producer = await transport.transport.produce({ 
      kind: kind as types.MediaKind, 
      rtpParameters 
    });

    room.producers.set(producer.id, producer);
    transport.transport.appData.producerId = producer.id;

    peer.isStreaming = true;

    return {
      producerId: producer.id,
      notifyData: await this.notifyNewProducer(roomId, producer.id, peerId)
    };
  }

  // Add methods for handling consumers
  async createConsumer(roomId: string, consumerPeerId: string, producerId: string, rtpCapabilities: any) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(consumerPeerId);
    if (!peer) throw new Error('Peer not found');

    const producer = room.producers.get(producerId);
    if (!producer) throw new Error('Producer not found');

    const transport = peer.transports.find(t => t.type === 'consumer');
    if (!transport) throw new Error('Consumer transport not found');

    const consumer = await transport.transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true,
    });

    room.consumers.set(consumer.id, consumer);

    return {
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    };
  }

  async notifyNewProducer(roomId: string, producerId: string, excludePeerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    const producer = room.producers.get(producerId);
    if (!producer) throw new Error('Producer not found');

    return {
      producerId: producer.id,
      producerPeerId: excludePeerId,
      kind: producer.kind
    };
  }

  getRooms(): Map<string, Room> {
    return this.rooms;
  }

  async getActiveUsers(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) {
        throw new Error(`Room ${roomId} not found`);
    }

    return Array.from(room.peers.values()).map(peer => ({
        id: peer.id,
        username: peer.username,
        isStreaming: peer.isStreaming,
    }));
  }

  static async getActiveUsers(roomId: string) {
    const room = (await new MediasoupService()).rooms.get(roomId);
    if (!room) {
        throw new Error(`Room ${roomId} not found`);
    }

    return Array.from(room.peers.values()).map(peer => ({
        id: peer.id,
        username: peer.username,
        isStreaming: peer.isStreaming,
    }));
  }

  private async handleNewProducer(data: any) {
    console.log('New producer data received:', data);
  }

  async createSendTransport() {
    console.log('Creating send transport for:', { roomId: this.roomId, peerId: this.peerId });
  }

  async publish(stream: MediaStream) {
    console.log('Publishing stream with tracks:', stream.getTracks());
    
    // Ensure roomId and peerId are not null
    if (!this.roomId) {
        throw new Error('Room ID is not set');
    }
    if (!this.peerId) {
        throw new Error('Peer ID is not set');
    }

    const room = this.rooms.get(this.roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    const peer = room.peers.get(this.peerId);
    if (!peer) {
        throw new Error('Peer not found');
    }

    const transport = peer.transports.find(t => t.type === 'producer');
    if (!transport) {
        throw new Error('Producer transport not found');
    }

    const producers = await Promise.all(stream.getTracks().map(async (track) => {
        console.log('Producing media:', { kind: track.kind });
        
        // Define the kind and rtpParameters based on the track
        const kind = track.kind; // 'audio' or 'video'
        
        // Define rtpParameters with required codecs
        const rtpParameters = {
            codecs: [
                {
                    mimeType: kind === 'audio' ? 'audio/opus' : 'video/VP8', // Adjust based on your codec
                    payloadType: 100, // Example payload type
                    clockRate: kind === 'audio' ? 48000 : 90000, // Adjust clock rate based on media type
                    channels: kind === 'audio' ? 2 : undefined, // Only for audio
                }
            ],
            headerExtensions: [],
            // Add any other required properties here
        };

        const producer = await transport.transport.produce({
            track,
            kind, // Add the kind
            rtpParameters, // Add the rtpParameters
            appData: { /* any additional app data */ } // Ensure appData is defined if needed
        } as types.ProducerOptions); // Cast to the correct type if necessary

        room.producers.set(producer.id, producer);
        peer.isStreaming = true;
        return producer;
    }));

    return producers;
  }

  private notifyActiveUsers(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const activeUsers = Array.from(room.peers.values()).map(peer => ({
        id: peer.id,
        username: peer.username,
        isStreaming: peer.isStreaming,
    }));

    this.broadcastToRoom(roomId, {
        type: 'activeUsersUpdate',
        data: activeUsers,
    });
  }

  private async handleUserJoin(roomId: string, peerId: string, username: string) {
    this.notifyActiveUsers(roomId);
  }

  private async handleUserLeave(roomId: string, peerId: string) {
    this.notifyActiveUsers(roomId);
  }

  private broadcastToRoom(roomId: string, message: any) {
    // Implementation of broadcastToRoom method
  }
}

export default new MediasoupService(); 