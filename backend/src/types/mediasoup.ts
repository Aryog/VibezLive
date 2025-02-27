import { types } from 'mediasoup';
import { JoinResponse } from '../types/joinResponse';

export interface MediasoupWorker {
  worker: types.Worker;
  router: types.Router;
}

export interface TransportAppData {
  [key: string]: string | undefined;
  producerId?: string;
}

export interface Transport {
  transport: types.WebRtcTransport<TransportAppData>;
  type: 'producer' | 'consumer';
}

export interface RoomProducer extends types.Producer<TransportAppData> {
  id: string;
  peerId: string;
  kind: types.MediaKind;
  // Include any other properties required by Producer<AppData>
}

export interface Room {
  id: string;
  router: types.Router;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
  peers: Map<string, {
    id: string;
    username: string;
    isStreaming: boolean;
    transports: {
      transport: types.WebRtcTransport<TransportAppData>;
      type: 'producer' | 'consumer';
    }[];
  }>;
}


export interface Peer {
  id: string;
  username: string;
  isStreaming: boolean;
  transports: Array<{
    transport: any; // Replace with proper transport type if available
    type: 'producer' | 'consumer';
  }>;
  producerId?: string; // Add this
}

export interface ActiveUser {
  id: string;
  username: string;
  isStreaming: boolean;
  producerId?: string;
}

export interface MediasoupService {
  join(roomId: string, peerId: string, username: string): Promise<JoinResponse>;
  setupProducer(roomId: string, peerId: string): Promise<string>;
  publish(stream: MediaStream): Promise<any>;
  consumeStream(producerId: string, username: string): Promise<any>;
  closeProducers(): Promise<void>;
  setOnNewConsumer(callback: (consumer: any, username: string) => void): void;
}