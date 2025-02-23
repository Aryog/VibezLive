import * as mediasoup from 'mediasoup';
import { types } from 'mediasoup';
import { config } from '../config/mediasoup.config';
import { MediasoupWorker, Room, TransportAppData, Peer , RoomProducer} from '../types/mediasoup';

export class MediasoupService {
  private static instance: MediasoupService;
  private workers: MediasoupWorker[] = [];
  private rooms: Map<string, Room> = new Map();
  private workerIndex = 0;

  constructor() {
    if (MediasoupService.instance) {
      return MediasoupService.instance;
    }
    MediasoupService.instance = this;
  }

  async init(numWorkers: number = 1) {
    try {
      for (let i = 0; i < numWorkers; i++) {
        const worker = await mediasoup.createWorker(config.mediasoup.worker as types.WorkerSettings);
        
        // Handle worker errors and exits
        worker.on('died', () => {
          console.error(`Worker ${worker.pid} died, exiting in 2 seconds... [pid:${process.pid}]`);
          setTimeout(() => process.exit(1), 2000);
        });

        const router = await worker.createRouter({
          mediaCodecs: config.mediasoup.router.mediaCodecs as types.RtpCodecCapability[]
        });

        this.workers.push({ worker, router });
        console.log(`Created mediasoup worker ${i + 1}/${numWorkers} [pid:${worker.pid}]`);
      }
    } catch (error) {
      console.error('Failed to initialize mediasoup workers:', error);
      throw new Error('Failed to initialize mediasoup workers');
    }
  }
  
  async createRoom(roomId: string): Promise<Room> {
    try {
      if (this.rooms.has(roomId)) {
        return this.rooms.get(roomId)!;
      }

      const worker = this.getNextWorker();
      if (!worker) {
        throw new Error('No available mediasoup workers');
      }

      const router = await worker.worker.createRouter({
        mediaCodecs: config.mediasoup.router.mediaCodecs as types.RtpCodecCapability[],
      });

      const room: Room = {
        id: roomId,
        router,
        producers: new Map(),
        consumers: new Map(),
        peers: new Map(),
      };

      this.rooms.set(roomId, room);
      console.log(`Created room: ${roomId}`);
      return room;
    } catch (error) {
      console.error(`Error creating room ${roomId}:`, error);
      throw new Error(`Failed to create room: ${error instanceof Error ? error.message : 'Unknown error' }`);
    }
  }

  async createWebRtcTransport(roomId: string, peerId: string, type: 'producer' | 'consumer'): Promise<{
    id: string;
    iceParameters: types.IceParameters;
    iceCandidates: types.IceCandidate[];
    dtlsParameters: types.DtlsParameters;
  }> {
    try {
      const room = this.getRoom(roomId);
      
      const transport = await room.router.createWebRtcTransport({
        ...config.mediasoup.webRtcTransport,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        appData: { peerId, type } as TransportAppData
      });
  
      // Handle transport events
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'failed' || dtlsState === 'closed') {
          console.warn('WebRtcTransport dtls state changed to', dtlsState);
        }
      });
  
      const peer = this.getOrCreatePeer(room, peerId);
      peer.transports.push({ transport, type });
  
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    } catch (error) {
      console.error(`Error creating WebRTC transport for peer ${peerId} in room ${roomId}:`, error);
      throw new Error(`Failed to create WebRTC transport: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createProducer(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: types.MediaKind,
    rtpParameters: types.RtpParameters
  ) {
    try {
      const room = this.getRoom(roomId);
      const peer = this.getPeer(room, peerId);
      
      const transport = peer.transports.find(t => t.transport.id === transportId);
      if (!transport) {
        throw new Error(`Transport ${transportId} not found for peer ${peerId}`);
      }
  
      const producer = await transport.transport.produce({
        kind,
        rtpParameters,
        appData: { 
          peerId,
          transportId 
        }
      });
  
      // Handle producer events
      producer.on('transportclose', () => {
        console.log('Producer transport closed', { producerId: producer.id, peerId });
        if (room.producers.has(producer.id)) {
          room.producers.delete(producer.id);
          // Update peer status when producer is closed
          if (peer) {
            peer.isStreaming = false;
            peer.producerId = undefined;
          }
        }
      });


      room.producers.set(producer.id, producer);
      transport.transport.appData.producerId = producer.id;
      peer.isStreaming = true;

  
      room.producers.set(producer.id, producer);
      transport.transport.appData.producerId = producer.id;
      peer.isStreaming = true;

      return {
        producerId: producer.id,
        notifyData: {
          producerId: producer.id,
          producerPeerId: peerId,
          kind: producer.kind
        }
      };
    } catch (error) {
      console.error(`Error creating producer for peer ${peerId} in room ${roomId}:`, error);
      throw error;
    }
  }


  async createConsumer(
    roomId: string,
    consumerPeerId: string,
    producerId: string,
    rtpCapabilities: types.RtpCapabilities
  ) {
    try {
      const room = this.getRoom(roomId);
      const peer = this.getPeer(room, consumerPeerId);
      const producer = room.producers.get(producerId);

      if (!producer) {
        throw new Error(`Producer ${producerId} not found`);
      }

      const transport = peer.transports.find((t: { transport: { id: string; }; type: string; }) => t.type === 'consumer');
      if (!transport) {
        throw new Error('Consumer transport not found');
      }

      // Check if the peer can consume the producer
      if (!room.router.canConsume({
        producerId: producer.id,
        rtpCapabilities,
      })) {
        throw new Error('Peer cannot consume producer');
      }

      const consumer = await transport.transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: true, // Start paused, resume after handling 'resume' event
        appData: {
          peerId: consumerPeerId,
          username: peer.username
        }
      });

      // Handle consumer events
      consumer.on('transportclose', () => {
        console.log('Consumer transport closed', { consumerId: consumer.id });
        room.consumers.delete(consumer.id);
      });

      consumer.on('producerclose', () => {
        console.log('Consumer producer closed', { consumerId: consumer.id });
        room.consumers.delete(consumer.id);
      });

      room.consumers.set(consumer.id, consumer);

      return {
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
        username: peer.username
      };
    } catch (error) {
      console.error(`Error creating consumer for peer ${consumerPeerId} in room ${roomId}:`, error);
      throw new Error(`Failed to create consumer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getNextWorker(): MediasoupWorker {
    const worker = this.workers[this.workerIndex];
    this.workerIndex = (this.workerIndex + 1) % this.workers.length;
    return worker;
  }

  private getRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }
    return room;
  }

  private getPeer(room: Room, peerId: string): Peer {
    const peer = room.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} not found`);
    }
    return peer;
  }

  private getOrCreatePeer(room: Room, peerId: string): Peer {
    let peer = room.peers.get(peerId);
    if (!peer) {
      peer = {
        id: peerId,
        username: '',
        isStreaming: false,
        transports: [],
      };
      room.peers.set(peerId, peer);
    }
    return peer;
  }

  private getTransport(peer: Peer, transportId: string) {
    const transport = peer.transports.find((t: { transport: { id: string; }; }) => t.transport.id === transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }
    return transport;
  }

  getRooms(): Map<string, Room> {
    return this.rooms;
  }

  async cleanup() {
    try {
      // Close all transports in all rooms
      for (const room of this.rooms.values()) {
        for (const peer of room.peers.values()) {
          for (const transport of peer.transports) {
            await transport.transport.close();
          }
        }
      }

      // Close all workers
      for (const worker of this.workers) {
        await worker.worker.close();
      }

      this.rooms.clear();
      this.workers = [];
      this.workerIndex = 0;
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  getActiveUsers(roomId: string): Peer[] {
    const room = this.getRoom(roomId);
    return Array.from(room.peers.values());
  }
}

export default new MediasoupService();