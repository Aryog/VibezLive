import * as mediasoupClient from 'mediasoup-client';
import { types } from 'mediasoup-client';
import WebSocketService from './WebSocketService';
import { JoinResponse } from '../types/joinResponse';

interface ConsumeResponse {
  id: string;
  producerId: string;
  kind: 'audio' | 'video';
  rtpParameters: any;
  error?: string;
}

interface User {
  id: string;
  username: string;
  isStreaming: boolean;
}

export class MediasoupService {
  private device: mediasoupClient.Device;
  private isDeviceLoaded = false;
  private producerTransport: types.Transport | null = null;
  private consumerTransport: types.Transport | null = null;
  private producers: Map<string, types.Producer> = new Map();
  private consumers: Map<string, types.Consumer> = new Map();
  private onNewConsumer: ((consumer: types.Consumer, username: string) => void) | null = null;
  private roomId: string | null = null;
  private peerId: string | null = null;
  private activeUsers: Map<string, User> = new Map();
  private activeUsersCallbacks: Array<(users: User[]) => void> = [];

  constructor() {
    this.device = new mediasoupClient.Device();
    this.setupWebSocketListeners();
  }

  private setupWebSocketListeners() {
    WebSocketService.on('newProducer', this.handleNewProducer.bind(this));
    WebSocketService.on('userJoined', this.handleUserJoined.bind(this));
    WebSocketService.on('userLeft', this.handleUserLeft.bind(this));
    WebSocketService.on('peerStreamingStatusChanged', this.handlePeerStreamingStatusChanged.bind(this));
  }

  private async handleNewProducer(data: any) {
    try {
      if (!this.canHandleNewProducer(data)) return;
      
      if (await this.ensureConsumerTransport()) {
        await this.setupConsumer(data);
        this.updateUserStreamingStatus(data.producerPeerId, true);
      }
    } catch (error) {
      console.error('Error handling new producer:', error);
    }
  }

  private canHandleNewProducer(data: any): boolean {
    if (data.producerPeerId === this.peerId) return false;
    if (!this.device.loaded) {
      console.warn('Device not loaded yet');
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
    if (!this.roomId || !this.device.rtpCapabilities) return;

    WebSocketService.send('consume', {
      roomId: this.roomId,
      producerId: data.producerId,
      rtpCapabilities: this.device.rtpCapabilities
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Consume timeout'));
        cleanup();
      }, 10000);

      const handleConsumed = async (response: ConsumeResponse) => {
        try {
          if (!this.consumerTransport) throw new Error('No consumer transport');

          const consumer = await this.consumerTransport.consume({
            id: response.id,
            producerId: response.producerId,
            kind: response.kind,
            rtpParameters: response.rtpParameters,
          });

          this.consumers.set(consumer.id, consumer);
          
          await this.resumeConsumer(consumer);

          if (this.onNewConsumer) {
            this.onNewConsumer(consumer, data.username);
          }

          clearTimeout(timeout);
          resolve(consumer);
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };

      const cleanup = () => {
        WebSocketService.off('consumed', handleConsumed);
      };

      WebSocketService.on('consumed', handleConsumed);
    });
  }

  private async resumeConsumer(consumer: types.Consumer) {
    WebSocketService.send('resumeConsumer', {
      roomId: this.roomId,
      consumerId: consumer.id
    });

    await consumer.resume();
  }

  async loadDevice(routerRtpCapabilities: types.RtpCapabilities) {
    try {
      if (!this.isDeviceLoaded) {
        await this.device.load({ routerRtpCapabilities });
        this.isDeviceLoaded = true;
      }
    } catch (error) {
      console.error('Failed to load mediasoup device:', error);
      throw error;
    }
  }

  async join(roomId: string, peerId: string, username: string): Promise<JoinResponse> {
    this.roomId = roomId;
    this.peerId = peerId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join timeout'));
        cleanup();
      }, 10000);

      const handleJoined = async (data: any) => {
        try {
          await this.loadDevice(data.routerRtpCapabilities);
          await this.createConsumerTransport();
          await this.createSendTransport();

          this.activeUsers.set(peerId, {
            id: peerId,
            username,
            isStreaming: false
          });

          if (data.existingProducers) {
            for (const producer of data.existingProducers) {
              await this.consumeStream(producer.producerId, producer.username);
            }
          }

          clearTimeout(timeout);
          resolve(data as JoinResponse);
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };

      const handleError = (error: any) => {
        clearTimeout(timeout);
        reject(error);
        cleanup();
      };

      const cleanup = () => {
        WebSocketService.off('joined', handleJoined);
        WebSocketService.off('error', handleError);
      };

      WebSocketService.on('joined', handleJoined);
      WebSocketService.on('error', handleError);
      WebSocketService.send('join', { roomId, peerId, username });
    });
  }

  async createConsumerTransport() {
    return new Promise((resolve, reject) => {
      if (!this.roomId || !this.peerId) {
        reject(new Error('Room or peer ID not set'));
        return;
      }

      WebSocketService.send('createTransport', {
        type: 'consumer',
        roomId: this.roomId,
        peerId: this.peerId
      });

      const timeout = setTimeout(() => {
        reject(new Error('Create consumer transport timeout'));
        cleanup();
      }, 10000);

      const handleTransportCreated = async (data: any) => {
        try {
          this.consumerTransport = this.device.createRecvTransport(data);

          this.consumerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            WebSocketService.send('connectTransport', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.consumerTransport?.id,
              dtlsParameters
            });

            const handleConnected = () => {
              callback();
              WebSocketService.off('transportConnected', handleConnected);
            };

            WebSocketService.on('transportConnected', handleConnected);
            WebSocketService.on('error', errback);
          });

          clearTimeout(timeout);
          resolve(this.consumerTransport);
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };

      const cleanup = () => {
        WebSocketService.off('transportCreated', handleTransportCreated);
      };

      WebSocketService.on('transportCreated', handleTransportCreated);
    });
  }

  async createSendTransport() {
    return new Promise((resolve, reject) => {
      if (!this.roomId || !this.peerId) {
        reject(new Error('Room or peer ID not set'));
        return;
      }

      WebSocketService.send('createTransport', {
        type: 'producer',
        roomId: this.roomId,
        peerId: this.peerId
      });

      const timeout = setTimeout(() => {
        reject(new Error('Create send transport timeout'));
        cleanup();
      }, 10000);

      const handleTransportCreated = async (data: any) => {
        try {
          this.producerTransport = this.device.createSendTransport(data);

          this.producerTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
            WebSocketService.send('connectTransport', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.producerTransport?.id,
              dtlsParameters
            });

            const handleConnected = () => {
              callback();
              WebSocketService.off('transportConnected', handleConnected);
            };

            WebSocketService.on('transportConnected', handleConnected);
            WebSocketService.on('error', errback);
          });

          this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            WebSocketService.send('produce', {
              roomId: this.roomId,
              peerId: this.peerId,
              transportId: this.producerTransport?.id,
              kind,
              rtpParameters
            });

            const handleProduced = (data: any) => {
              callback({ id: data.producerId });
              WebSocketService.off('produced', handleProduced);
            };

            WebSocketService.on('produced', handleProduced);
            WebSocketService.on('error', errback);
          });

          clearTimeout(timeout);
          resolve(this.producerTransport);
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };

      const cleanup = () => {
        WebSocketService.off('transportCreated', handleTransportCreated);
      };

      WebSocketService.on('transportCreated', handleTransportCreated);
    });
  }

  async consumeStream(producerId: string, producerUsername: string) {
    console.log('Consuming stream:', producerId, producerUsername);
    if (!this.consumerTransport || !this.device.rtpCapabilities) {
      throw new Error('Consumer transport or device not ready');
    }

    return new Promise((resolve, reject) => {
      WebSocketService.send('consume', {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
        roomId: this.roomId,
        consumerPeerId: this.peerId
      });

      const timeout = setTimeout(() => {
        reject(new Error('Consume stream timeout'));
        cleanup();
      }, 10000);

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

          clearTimeout(timeout);
          resolve(consumer);
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };

      const cleanup = () => {
        WebSocketService.off('consumed', handleConsumed);
      };

      WebSocketService.on('consumed', handleConsumed);
    });
  }

  async publish(stream: MediaStream) {
    if (!this.producerTransport) {
      throw new Error('Producer transport not available');
    }

    const producers: types.Producer[] = [];

    for (const track of stream.getTracks()) {
      try {
        const producer = await this.producerTransport.produce({ track });
        this.producers.set(producer.id, producer);
        producers.push(producer);

        producer.on('transportclose', () => {
          console.log('Producer transport closed:', producer.id);
          this.producers.delete(producer.id);
        });

        producer.on('trackended', () => {
          console.log('Producer track ended:', producer.id);
          this.closeProducer(producer.id);
        });
      } catch (error) {
        console.error(`Failed to publish ${track.kind} track:`, error);
        // Close any successfully created producers if one fails
        for (const p of producers) {
          await this.closeProducer(p.id);
        }
        throw error;
      }
    }

    if (this.peerId) {
      this.updateUserStreamingStatus(this.peerId, true);
    }

    return producers;
  }

  async closeProducers() {
    const producerIds = Array.from(this.producers.keys());
    for (const producerId of producerIds) {
      await this.closeProducer(producerId);
    }

    if (this.peerId) {
      this.updateUserStreamingStatus(this.peerId, false);
    }
  }

  private async closeProducer(producerId: string) {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.close();
      this.producers.delete(producerId);
      
      WebSocketService.send('closeProducer', {
        roomId: this.roomId,
        producerId
      });
    }
  }

  setOnNewConsumer(callback: (consumer: types.Consumer, username: string) => void) {
    this.onNewConsumer = callback;
  }

  private updateUserStreamingStatus(peerId: string, isStreaming: boolean) {
    const user = this.activeUsers.get(peerId);
    if (user) {
      user.isStreaming = isStreaming;
      this.notifyActiveUsers();
    }
  }

  private handlePeerStreamingStatusChanged(data: { peerId: string; isStreaming: boolean }) {
    this.updateUserStreamingStatus(data.peerId, data.isStreaming);
  }

  private handleUserJoined(data: { username: string; peerId: string }) {
    this.activeUsers.set(data.peerId, {
      id: data.peerId,
      username: data.username,
      isStreaming: false
    });
    this.notifyActiveUsers();
  }

  private handleUserLeft(data: { username: string; peerId: string }) {
    // Clean up consumers for this user
    for (const [consumerId, consumer] of this.consumers) {
      if (consumer.producerId === data.peerId) {
        consumer.close();
        this.consumers.delete(consumerId);
      }
    }

    this.activeUsers.delete(data.peerId);
    this.notifyActiveUsers();
  }

  private notifyActiveUsers() {
    const users = Array.from(this.activeUsers.values());
    this.activeUsersCallbacks.forEach(callback => callback(users));
  }

  public onActiveUsersUpdate(callback: (users: User[]) => void) {
    this.activeUsersCallbacks.push(callback); // Register a new callback
  }
}

export default new MediasoupService(); 