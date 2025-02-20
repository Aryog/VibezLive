import * as mediasoupClient from 'mediasoup-client';
import { types } from 'mediasoup-client';
import WebSocketService from './WebSocketService';

export class MediasoupService {
  private device: mediasoupClient.Device;
  private isDeviceLoaded = false;
  private producerTransport: types.Transport | null = null;
  private consumerTransport: types.Transport | null = null;
  private producer: types.Producer | null = null;
  private consumers: Map<string, types.Consumer> = new Map();
  private onNewConsumer: ((consumer: types.Consumer) => void) | null = null;
  private roomId: string | null = null;
  private peerId: string | null = null;

  constructor() {
    this.device = new mediasoupClient.Device();
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    WebSocketService.on('newProducer', async (data) => {
      console.log('New producer notification received:', data);
      try {
        if (!this.device.loaded) {
          console.warn('Device not loaded yet, cannot consume stream');
          return;
        }

        if (!this.consumerTransport) {
          console.warn('Consumer transport not created yet');
          return;
        }

        await this.consumeStream(data.producerId);
      } catch (error) {
        console.error('Error consuming new producer:', error);
      }
    });
  }

  async loadDevice(routerRtpCapabilities: types.RtpCapabilities) {
    try {
      // Only load the device if it hasn't been loaded yet
      if (!this.isDeviceLoaded) {
        await this.device.load({ routerRtpCapabilities });
        this.isDeviceLoaded = true;
      }
    } catch (error) {
      console.error('Failed to load mediasoup device:', error);
      throw error;
    }
  }

  async join(roomId: string, peerId: string) {
    this.roomId = roomId;
    this.peerId = peerId;

    console.log('Joining room:', { roomId, peerId });

    WebSocketService.send('join', { roomId, peerId });

    return new Promise((resolve, reject) => {
      WebSocketService.on('joined', async (data) => {
        try {
          console.log('Joined room:', data);
          await this.loadDevice(data.routerRtpCapabilities);
          await this.createConsumerTransport();
          await this.createSendTransport(); // Create send transport right after joining
          resolve(data);
        } catch (error) {
          console.error('Error joining room:', error);
          reject(error);
        }
      });

      WebSocketService.on('error', (error) => {
        console.error('Join error:', error);
        reject(error);
      });
    });
  }

  async createConsumerTransport() {
    return new Promise((resolve, reject) => {
      console.log('Creating consumer transport:', {
        roomId: this.roomId,
        peerId: this.peerId
      });

      WebSocketService.send('createTransport', { 
        type: 'consumer',
        roomId: this.roomId,
        peerId: this.peerId
      });

      WebSocketService.on('transportCreated', async (data) => {
        try {
          console.log('Transport created:', data);
          this.consumerTransport = this.device.createRecvTransport(data);

          this.consumerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            console.log('Consumer transport connect:', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.consumerTransport?.id
            });

            WebSocketService.send('connectTransport', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.consumerTransport?.id,
              dtlsParameters
            });

            WebSocketService.on('transportConnected', () => {
              console.log('Consumer transport connected');
              callback();
            });

            WebSocketService.on('error', (error) => {
              console.error('Consumer transport connection error:', error);
              errback(error);
            });
          });

          resolve(this.consumerTransport);
        } catch (error) {
          console.error('Error creating consumer transport:', error);
          reject(error);
        }
      });

      WebSocketService.on('error', (error) => {
        console.error('Transport creation error:', error);
        reject(error);
      });
    });
  }

  async consumeStream(producerId: string) {
    if (!this.consumerTransport) {
      throw new Error('Consumer transport not created');
    }

    console.log('Consuming stream:', {
      producerId,
      roomId: this.roomId,
      peerId: this.peerId
    });

    WebSocketService.send('consume', {
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
      roomId: this.roomId,
      consumerPeerId: this.peerId
    });

    return new Promise((resolve, reject) => {
      WebSocketService.on('consumed', async (data) => {
        try {
          if (!this.consumerTransport) {
            throw new Error('Consumer transport not created');
          }

          const consumer = await this.consumerTransport.consume({
            id: data.id,
            producerId: data.producerId,
            kind: data.kind,
            rtpParameters: data.rtpParameters,
          });

          this.consumers.set(consumer.id, consumer);
          await consumer.resume();

          if (this.onNewConsumer) {
            this.onNewConsumer(consumer);
          }

          resolve(consumer);
        } catch (error) {
          console.error('Error consuming stream:', error);
          reject(error);
        }
      });

      WebSocketService.on('error', (error) => {
        console.error('Consume error:', error);
        reject(error);
      });
    });
  }

  setOnNewConsumer(callback: (consumer: types.Consumer) => void) {
    this.onNewConsumer = callback;
  }

  async createSendTransport() {
    return new Promise((resolve, reject) => {
      WebSocketService.send('createTransport', {
        type: 'producer',
        roomId: this.roomId,
        peerId: this.peerId
      });

      WebSocketService.on('transportCreated', async (data) => {
        try {
          this.producerTransport = this.device.createSendTransport(data);

          this.producerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            WebSocketService.send('connectTransport', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.producerTransport?.id,
              dtlsParameters
            });

            WebSocketService.on('transportConnected', () => {
              callback();
            });

            WebSocketService.on('error', (error) => {
              errback(error);
            });
          });

          this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            WebSocketService.send('produce', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.producerTransport?.id,
              kind,
              rtpParameters
            });

            WebSocketService.on('produced', (data) => {
              callback({ id: data.producerId });
            });

            WebSocketService.on('error', (error) => {
              errback(error);
            });
          });

          resolve(this.producerTransport);
        } catch (error) {
          reject(error);
        }
      });

      WebSocketService.on('error', (error) => {
        reject(error);
      });
    });
  }

  async publish(stream: MediaStream) {
    if (!this.producerTransport) {
      throw new Error('Send transport not created');
    }

    console.log('Publishing stream:', {
      roomId: this.roomId,
      peerId: this.peerId,
      transportId: this.producerTransport.id
    });

    const track = stream.getVideoTracks()[0];
    this.producer = await this.producerTransport.produce({ track });
    
    console.log('Producer created:', {
      id: this.producer.id,
      kind: this.producer.kind
    });

    return this.producer;
  }
}

export default new MediasoupService(); 