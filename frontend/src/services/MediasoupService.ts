import * as mediasoupClient from 'mediasoup-client';
import WebSocketService from './WebSocketService';

export class MediasoupService {
  private device: mediasoupClient.Device;
  private producerTransport: mediasoupClient.Transport | null = null;
  private consumerTransport: mediasoupClient.Transport | null = null;
  private producer: mediasoupClient.Producer | null = null;
  private consumers: Map<string, mediasoupClient.Consumer> = new Map();
  private onNewConsumer: ((consumer: mediasoupClient.Consumer) => void) | null = null;

  constructor() {
    this.device = new mediasoupClient.Device();
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    WebSocketService.on('newProducer', async (data) => {
      await this.consumeStream(data.producerId);
    });
  }

  async join(roomId: string, peerId: string) {
    WebSocketService.send('join', { roomId, peerId });

    return new Promise((resolve) => {
      WebSocketService.on('joined', async (data) => {
        await this.device.load({ routerRtpCapabilities: data.routerRtpCapabilities });
        await this.createConsumerTransport();
        resolve(data);
      });
    });
  }

  async createConsumerTransport() {
    WebSocketService.send('createTransport', { type: 'consumer' });

    return new Promise((resolve) => {
      WebSocketService.on('transportCreated', async (data) => {
        this.consumerTransport = this.device.createRecvTransport(data);

        this.consumerTransport.on('connect', ({ dtlsParameters }, callback) => {
          WebSocketService.send('connectTransport', { dtlsParameters });
          callback();
        });

        resolve(this.consumerTransport);
      });
    });
  }

  async consumeStream(producerId: string) {
    if (!this.consumerTransport) {
      throw new Error('Consumer transport not created');
    }

    WebSocketService.send('consume', {
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    WebSocketService.on('consumed', async (data) => {
      const consumer = await this.consumerTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);
      consumer.resume();

      if (this.onNewConsumer) {
        this.onNewConsumer(consumer);
      }
    });
  }

  setOnNewConsumer(callback: (consumer: mediasoupClient.Consumer) => void) {
    this.onNewConsumer = callback;
  }

  async createSendTransport() {
    WebSocketService.send('createTransport', { type: 'producer' });

    return new Promise((resolve) => {
      WebSocketService.on('transportCreated', async (data) => {
        this.producerTransport = this.device.createSendTransport(data);

        this.producerTransport.on('connect', ({ dtlsParameters }, callback) => {
          WebSocketService.send('connectTransport', { dtlsParameters });
          callback();
        });

        this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback) => {
          WebSocketService.send('produce', { kind, rtpParameters });
          WebSocketService.on('produced', (data) => {
            callback({ id: data.producerId });
          });
        });

        resolve(this.producerTransport);
      });
    });
  }

  async publish(stream: MediaStream) {
    if (!this.producerTransport) {
      throw new Error('Send transport not created');
    }

    const track = stream.getVideoTracks()[0];
    this.producer = await this.producerTransport.produce({ track });
    return this.producer;
  }
}

export default new MediasoupService(); 