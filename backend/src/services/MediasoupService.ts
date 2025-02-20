import * as mediasoup from 'mediasoup';
import { config } from '../config/mediasoup.config';
import { MediasoupWorker, Room } from '../types/mediasoup';
import { types } from 'mediasoup';

export class MediasoupService {
  private workers: MediasoupWorker[] = [];
  private rooms: Map<string, Room> = new Map();
  private workerIndex = 0;

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
    return room;
  }

  async createWebRtcTransport(roomId: string, peerId: string, type: 'producer' | 'consumer') {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }

    const transport = await room.router.createWebRtcTransport(config.mediasoup.webRtcTransport);

    if (!room.peers.has(peerId)) {
      room.peers.set(peerId, {
        id: peerId,
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
    if (!room) throw new Error('Room not found');

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error('Peer not found');

    const transport = peer.transports.find(t => t.transport.id === transportId);
    if (!transport) throw new Error('Transport not found');

    const producer = await transport.transport.produce({ kind: kind as types.MediaKind, rtpParameters });
    room.producers.set(producer.id, producer);

    return producer.id;
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

  getRooms() {
    return this.rooms;
  }
}

export default new MediasoupService(); 