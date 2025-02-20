import { types } from 'mediasoup';

export interface MediasoupWorker {
  worker: types.Worker;
  router: types.Router;
}

export interface Room {
  id: string;
  router: types.Router;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
  peers: Map<string, {
    id: string;
    transports: {
      transport: types.WebRtcTransport;
      type: 'producer' | 'consumer';
    }[];
  }>;
} 