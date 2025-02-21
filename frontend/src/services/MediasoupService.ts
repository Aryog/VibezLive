import * as mediasoupClient from 'mediasoup-client';
import { types } from 'mediasoup-client';
import WebSocketService from './WebSocketService';

interface ConsumeResponse {
  id: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
  error?: string;
}

export class MediasoupService {
  private device: mediasoupClient.Device;
  private isDeviceLoaded = false;
  private producerTransport: types.Transport | null = null;
  private consumerTransport: types.Transport | null = null;
  private consumers: Map<string, types.Consumer> = new Map();
  private onNewConsumer: ((consumer: types.Consumer, username: string) => void) | null = null;
  private roomId: string | null = null;
  private peerId: string | null = null;
  private activeUsers: Set<string> = new Set();
  private activeUsersCallbacks: Array<(users: string[]) => void> = []; // Store callbacks

  constructor() {
    this.device = new mediasoupClient.Device();
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    WebSocketService.on('newProducer', this.handleNewProducer.bind(this));
    WebSocketService.on('userJoined', this.handleUserJoined.bind(this));
    WebSocketService.on('userLeft', this.handleUserLeft.bind(this));
  }

  private async handleNewProducer(data: any) {
    try {
      console.log('Handling new producer:', data);
      if (!this.canHandleNewProducer(data)) return;
      
      if (await this.ensureConsumerTransport()) {
        console.log('Creating consumer for producer:', data.producerId);
        await this.setupConsumer(data);
      }
    } catch (error) {
      console.error('Error handling new producer:', error);
    }
  }

  private canHandleNewProducer(data: any): boolean {
    if (data.producerPeerId === this.peerId) {
      return false; // Skip if it's our own producer
    }

    if (!this.device.loaded) {
      console.warn('Device not loaded yet, cannot consume stream');
      return false;
    }

    if (!this.device.rtpCapabilities || !this.device.canProduce('video')) {
      console.warn('Device cannot handle media');
      return false;
    }

    return true;
  }

  private async ensureConsumerTransport(): Promise<boolean> {
    if (!this.consumerTransport) {
      try {
        await this.createConsumerTransport();
        return true;
      } catch (error) {
        console.error('Failed to create consumer transport:', error);
        return false;
      }
    }
    return true;
  }

  private async setupConsumer(data: any) {
    WebSocketService.send('consume', {
      roomId: this.roomId,
      producerId: data.producerId,
      rtpCapabilities: this.device.rtpCapabilities
    });

    WebSocketService.on('consumed', async (response) => {
      try {
        await this.handleConsumed(response, data);
      } catch (error) {
        console.error('Error handling consumed response:', error);
      }
    });
  }

  private async handleConsumed(response: ConsumeResponse, producerData: any) {
    if (response.error) {
      throw new Error(response.error);
    }

    if (!this.consumerTransport) {
      throw new Error('Consumer transport not created');
    }

    const consumer = await this.consumerTransport.consume(response);
    await this.handleNewConsumer(consumer, producerData);
  }

  private async handleNewConsumer(consumer: types.Consumer, producerData: any) {
    const stream = new MediaStream([consumer.track]);
    
    await this.notifyNewConsumer(stream, consumer, producerData);
    await this.resumeConsumer(consumer);
  }

  private async notifyNewConsumer(
    stream: MediaStream, 
    consumer: types.Consumer, 
    producerData: any
  ) {
    WebSocketService.send('newConsumer', {
      stream,
      kind: consumer.kind,
      producerPeerId: producerData.producerPeerId
    });
  }

  private async resumeConsumer(consumer: types.Consumer) {
    WebSocketService.send('resumeConsumer', {
      roomId: this.roomId,
      consumerId: consumer.id
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

  async join(roomId: string, peerId: string, username: string) {
    this.roomId = roomId;
    this.peerId = peerId;

    console.log('Joining room:', { roomId, peerId, username });

    WebSocketService.send('join', { roomId, peerId, username });

    return new Promise((resolve, reject) => {
      WebSocketService.on('joined', async (data) => {
        try {
          console.log('Joined room:', data);
          await this.loadDevice(data.routerRtpCapabilities);
          
          // Create both transports right after joining
          await this.createConsumerTransport();
          await this.createSendTransport();

          // Handle existing producers after transports are ready
          if (data.existingProducers) {
            for (const producer of data.existingProducers) {
              await this.consumeStream(producer.producerId, producer.username);
            }
          }
          
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

  async consumeStream(producerId: string, producerUsername: string) {
    console.log('Consuming stream for producer:', producerId);
    if (!this.consumerTransport) {
      throw new Error('Consumer transport not created');
    }

    console.log('Consuming stream:', {
      producerId,
      roomId: this.roomId,
      peerId: this.peerId
    });

    return new Promise((resolve, reject) => {
      WebSocketService.send('consume', {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
        roomId: this.roomId,
        consumerPeerId: this.peerId
      });

      const handleConsumed = async (data: any) => {
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
            this.onNewConsumer(consumer, data.producerUsername || producerUsername);
          }

          resolve(consumer);
        } catch (error) {
          console.error('Error consuming stream:', error);
          reject(error);
        } finally {
          WebSocketService.off('consumed', handleConsumed);
        }
      };

      WebSocketService.on('consumed', handleConsumed);
    });
  }

  setOnNewConsumer(callback: (consumer: types.Consumer, username: string) => void) {
    this.onNewConsumer = callback;
  }

  async createSendTransport() {
    return new Promise((resolve, reject) => {
      console.log('Creating send transport for:', {
        roomId: this.roomId,
        peerId: this.peerId
      });

      WebSocketService.send('createTransport', {
        type: 'producer',
        roomId: this.roomId,
        peerId: this.peerId
      });

      const handleTransportCreated = async (data: any) => {
        try {
          console.log('Send transport created:', data);
          this.producerTransport = this.device.createSendTransport(data);

          this.producerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            console.log('Connecting send transport');
            WebSocketService.send('connectTransport', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.producerTransport?.id,
              dtlsParameters
            });

            const handleTransportConnected = () => {
              console.log('Send transport connected');
              callback();
              WebSocketService.off('transportConnected', handleTransportConnected);
            };

            WebSocketService.on('transportConnected', handleTransportConnected);
            WebSocketService.on('error', errback);
          });

          this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            console.log('Producing media:', { kind });
            WebSocketService.send('produce', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.producerTransport?.id,
              kind,
              rtpParameters
            });

            const handleProduced = (data: any) => {
              console.log('Media produced:', data);
              callback({ id: data.producerId });
              WebSocketService.off('produced', handleProduced);
            };

            WebSocketService.on('produced', handleProduced);
            WebSocketService.on('error', errback);
          });

          resolve(this.producerTransport);
        } catch (error) {
          console.error('Error creating send transport:', error);
          reject(error);
        } finally {
          WebSocketService.off('transportCreated', handleTransportCreated);
        }
      };

      WebSocketService.on('transportCreated', handleTransportCreated);
      WebSocketService.on('error', reject);
    });
  }

  async publish(stream: MediaStream) {
    console.log('Publishing stream with tracks:', stream.getTracks());
    for (const track of stream.getTracks()) {
        console.log('Publishing track:', track.kind); // Log track kind
        if (this.producerTransport) { // Check if producerTransport is not null
            await this.producerTransport.produce({ track }); // Remove the producer variable
        } else {
            console.error('Producer transport is not available');
        }
    }
}

  private handleUserJoined(data: { username: string }) {
    this.activeUsers.add(data.username);
    this.notifyActiveUsers();
  }

  private handleUserLeft(data: { username: string }) {
    this.activeUsers.delete(data.username);
    this.notifyActiveUsers();
  }

  private notifyActiveUsers() {
    const usersArray = Array.from(this.activeUsers);
    this.activeUsersCallbacks.forEach(callback => callback(usersArray)); // Call all registered callbacks
  }

  public onActiveUsersUpdate(callback: (users: string[]) => void) {
    this.activeUsersCallbacks.push(callback); // Register a new callback
  }
}

export default new MediasoupService(); 