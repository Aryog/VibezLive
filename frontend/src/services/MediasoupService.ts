import * as mediasoupClient from 'mediasoup-client';
import { Device, Transport, Producer, Consumer } from 'mediasoup-client/lib/types';

interface TransportOptions {
  id: string;
  iceParameters: any;
  iceCandidates: any;
  dtlsParameters: any;
  kind?: "audio" | "video";
}

interface User {
  id: string;
  username: string;
  isStreaming: boolean;
}

interface StreamInfo {
  peerId: string;
  stream: MediaStream;
  isLocal: boolean;
}

class MediasoupService {
  private device: Device | null = null;
  private socket: WebSocket | null = null;
  private producerTransports: Map<string, Transport> = new Map(); // Map of kind -> transport
  private consumerTransport: Transport | null = null;
  private producers: Map<string, Producer> = new Map();
  private consumers: Map<string, Consumer> = new Map();
  private roomId: string | null = null;
  private peerId: string | null = null;
  private onUserUpdateCallbacks: ((users: User[]) => void)[] = [];
  private isDeviceLoaded: boolean = false;
  private localStream: MediaStream | null = null;
  private remoteStreams: Map<string, MediaStream> = new Map();
  private onStreamCallbacks: ((streams: StreamInfo[]) => void)[] = [];
  private isConnecting: boolean = false;
  private pendingTransports: { [kind: string]: boolean } = {};

  constructor() {
    // Remove socket initialization from constructor
    // We'll only initialize when connecting to a room
  }

  async connectToRoom(roomId: string, peerId: string): Promise<void> {
    // Prevent multiple simultaneous connections
    if (this.isConnecting) {
      console.log('Connection already in progress');
      return;
    }

    this.isConnecting = true;

    try {
      // Cleanup any existing connection
      if (this.socket) {
        this.cleanup();
      }

      this.roomId = roomId;
      this.peerId = peerId;
      
      return new Promise((resolve, reject) => {
        try {
          const socket = new WebSocket('ws://localhost:5000');
          this.socket = socket;
          
          // Set up connection timeout
          const connectionTimeout = setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) {
              socket.close();
              reject(new Error('WebSocket connection timeout'));
            }
          }, 5000);

          socket.onopen = () => {
            console.log('WebSocket connected, state:', socket.readyState);
            clearTimeout(connectionTimeout);
            
            // Set up message and other event handlers
            socket.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data);
                console.log('Received message:', message);
                this.handleSocketMessage(message).catch((error: Error) => {
                  console.error('Error handling socket message:', error);
                });
              } catch (error) {
                console.error('Error parsing WebSocket message:', error);
              }
            };

            socket.onerror = (error: Event) => {
              console.error('WebSocket error:', error);
            };

            socket.onclose = (event) => {
              console.log(`WebSocket closed with code: ${event.code}, reason: ${event.reason}`);
              this.cleanup();
            };

            // Wait a bit before sending join message to ensure socket is ready
            setTimeout(() => {
              this.joinRoom(roomId, peerId).then(resolve).catch(reject);
            }, 100);
          };

          socket.onerror = (error: Event) => {
            console.error('WebSocket connection error:', error);
            clearTimeout(connectionTimeout);
            reject(new Error('WebSocket connection failed'));
          };

          socket.onclose = (event) => {
            console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
            clearTimeout(connectionTimeout);
            this.cleanup();
            reject(new Error('WebSocket connection closed'));
          };

        } catch (error: unknown) {
          this.isConnecting = false;
          reject(error instanceof Error ? error : new Error('Failed to connect to room'));
        }
      });
    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  private async joinRoom(roomId: string, peerId: string): Promise<void> {
    // Wait for socket to be fully open
    const waitForConnection = async (maxAttempts = 5): Promise<void> => {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const checkConnection = () => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            resolve();
          } else if (attempts >= maxAttempts) {
            reject(new Error('Failed to establish WebSocket connection'));
          } else {
            attempts++;
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
      });
    };

    try {
      await waitForConnection();

      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }

      // Initialize the device but don't try to access rtpCapabilities yet
      this.device = new mediasoupClient.Device();

      // Send join request without rtpCapabilities
      const joinMessage = {
        type: 'joinRoom',
        data: {
          roomId,
          peerId,
        },
      };

      console.log('Sending join room message:', joinMessage);
      this.socket.send(JSON.stringify(joinMessage));
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    }
  }

  async startStreaming(): Promise<void> {
    try {
      // Stop any existing stream
      if (this.localStream) {
        this.stopStreaming();
      }

      // Get user media
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });

      if (!this.device || !this.socket) throw new Error('Not connected to room');

      // Reset pending transports
      this.pendingTransports = { audio: true, video: true };

      // Request video transport
      this.socket.send(
        JSON.stringify({
          type: "createWebRtcTransport",
          data: {
            roomId: this.roomId,
            peerId: this.peerId,
            kind: "video",
            appData: { producing: true, kind: "video" },
          },
        })
      );

      // Request audio transport
      this.socket.send(
        JSON.stringify({
          type: "createWebRtcTransport",
          data: {
            roomId: this.roomId,
            peerId: this.peerId,
            kind: "audio",
            appData: { producing: true, kind: "audio" },
          },
        })
      );
      
      this.notifyStreamUpdate();
    } catch (error) {
      console.error('Error starting stream:', error);
      throw error;
    }
  }

  async stopStreaming(): Promise<void> {
    // Close producers first
    this.producers.forEach(producer => {
      try {
        producer.close();
      } catch (e) {
        console.error('Error closing producer:', e);
      }
    });
    this.producers.clear();
    
    // Close producer transports
    this.producerTransports.forEach(transport => {
      try {
        transport.close();
      } catch (e) {
        console.error('Error closing producer transport:', e);
      }
    });
    this.producerTransports.clear();

    // Stop local stream tracks
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      } catch (e) {
        console.error('Error stopping local stream tracks:', e);
      }
    }

    this.notifyStreamUpdate();
  }

  private async handleSocketMessage(message: any): Promise<void> {
    try {
      switch (message.type) {
        case 'joinRoomResponse':
          if (!this.device) throw new Error('Device not initialized');
          
          if (!this.isDeviceLoaded) {
            await this.device.load({ routerRtpCapabilities: message.data.routerRtpCapabilities });
            this.isDeviceLoaded = true;
            
            if (this.socket && this.peerId && this.roomId) {
              const capabilitiesMessage = {
                type: 'setRtpCapabilities',
                data: {
                  peerId: this.peerId,
                  roomId: this.roomId,
                  rtpCapabilities: this.device.rtpCapabilities
                }
              };
              this.socket.send(JSON.stringify(capabilitiesMessage));

              // Create consumer transport after device is loaded
              const transportMessage = {
                type: 'createWebRtcTransport',
                data: {
                  roomId: this.roomId,
                  peerId: this.peerId,
                  appData: { consuming: true },
                },
              };
              this.socket.send(JSON.stringify(transportMessage));

              // Handle existing producers in the room
              if (message.data.existingProducers?.length > 0) {
                console.log('Handling existing producers:', message.data.existingProducers);
                for (const producer of message.data.existingProducers) {
                  await this.consumeStream(producer);
                }
              }
            }
          }
          break;

        case 'newPeer':
          console.log('New peer joined:', message.data);
          break;

        case 'createWebRtcTransportResponse':
          const { transportOptions } = message.data;
          if (transportOptions.appData?.consuming) {
            if (!this.consumerTransport) {
              await this.handleConsumerTransportCreation(transportOptions);
            }
          } else {
            const kind = transportOptions.kind || transportOptions.appData?.kind;
            if (this.localStream && kind) {
              await this.handleProducerTransportCreation(transportOptions, kind);
            }
          }
          break;

        case 'newProducer':
          if (this.device?.loaded && this.consumerTransport) {
            await this.consumeStream(message.data);
          }
          break;

        case 'consumeResponse':
          const { id, producerId, kind, rtpParameters } = message.data;
          await this.handleConsume(id, producerId, kind, rtpParameters);
          break;

        case 'rtpCapabilitiesSet':
          console.log('RTP Capabilities set successfully');
          break;

        case 'transportConnected':
          console.log('Transport connected:', message.data);
          const { transportId, kind: connectedKind } = message.data;
          if (connectedKind && this.pendingTransports[connectedKind]) {
            delete this.pendingTransports[connectedKind];
            await this.produceTracksForKind(connectedKind);
          }
          break;
      }
    } catch (error) {
      if (error instanceof Error) {
        // Only log critical errors
        if (!error.message.includes('already loaded') && 
            !error.message.includes('Device not initialized or no local stream')) {
          console.error('Error handling socket message:', error);
          throw error;
        }
      }
    }
  }

  private async produceTracksForKind(kind: string): Promise<void> {
    if (!this.localStream) return;
    
    const transport = this.producerTransports.get(kind);
    if (!transport) return;

    // Find tracks of this kind
    for (const track of this.localStream.getTracks()) {
      if (track.kind === kind) {
        try {
          const producer = await transport.produce({
            track,
            encodings: track.kind === 'video' 
              ? [
                  { maxBitrate: 100000, scaleResolutionDownBy: 4 },
                  { maxBitrate: 300000, scaleResolutionDownBy: 2 },
                  { maxBitrate: 900000 }
                ]
              : undefined,
            codecOptions: track.kind === 'video'
              ? { videoGoogleStartBitrate: 1000 }
              : undefined,
          });
          this.producers.set(producer.id, producer);
          console.log(`Produced ${kind} track with id ${producer.id}`);
        } catch (error) {
          console.error(`Error producing ${track.kind} track:`, error);
        }
      }
    }
  }

  private async handleProducerTransportCreation(transportOptions: TransportOptions, kind: string): Promise<void> {
    if (!this.device || !this.localStream) {
      return; // Silently return instead of throwing
    }

    try {
      const transport = await this.device.createSendTransport({
        id: transportOptions.id,
        iceParameters: transportOptions.iceParameters,
        iceCandidates: transportOptions.iceCandidates,
        dtlsParameters: transportOptions.dtlsParameters,
      });

      transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await this.sendTransportConnect(transport.id, dtlsParameters, kind);
          callback();
        } catch (error) {
          errback(error instanceof Error ? error : new Error('Transport connection failed'));
        }
      });

      transport.on('produce', async ({ kind: trackKind, rtpParameters, appData }, callback, errback) => {
        try {
          const { id } = await this.sendTransportProduce(transport.id, trackKind, rtpParameters, appData);
          callback({ id });
        } catch (error) {
          errback(error instanceof Error ? error : new Error('Transport production failed'));
        }
      });

      // Store transport by kind
      this.producerTransports.set(kind, transport);
      console.log(`Created producer transport for ${kind}`);

      // Tracks will be produced when transport connected event is received
    } catch (error) {
      console.error(`Error in producer transport creation for ${kind}:`, error);
    }
  }

  private async sendTransportConnect(transportId: string, dtlsParameters: any, kind?: string): Promise<void> {
    if (!this.socket) throw new Error('WebSocket not connected');

    const message = {
      type: 'connectTransport',
      data: {
        peerId: this.peerId,
        transportId,
        dtlsParameters,
        kind
      },
    };

    this.socket.send(JSON.stringify(message));
  }

  private async sendTransportProduce(
    transportId: string,
    kind: string,
    rtpParameters: any,
    appData: any
  ): Promise<{ id: string }> {
    if (!this.socket) throw new Error('WebSocket not connected');

    const message = {
      type: 'produce',
      data: {
        peerId: this.peerId,
        transportId,
        kind,
        rtpParameters,
        roomId: this.roomId,
        appData,
      },
    };

    return new Promise((resolve) => {
      // In a real implementation, you'd have a way to correlate response to request
      // For simplicity, we'll just return a placeholder ID
      this.socket!.send(JSON.stringify(message));
      resolve({ id: `temp-${Date.now()}` });
    });
  }

  private async consumeStream({ id: producerId, kind, peerId, rtpParameters }: { 
    id: string; 
    kind: string; 
    peerId: string;
    rtpParameters?: any; 
  }): Promise<void> {
    try {
      if (!this.device || !this.socket) {
        throw new Error('Device or socket not initialized');
      }

      // Create consumer transport if it doesn't exist
      if (!this.consumerTransport) {
        const transportMessage = {
          type: 'createWebRtcTransport',
          data: {
            roomId: this.roomId,
            peerId: this.peerId,
            appData: { consuming: true },
          },
        };
        this.socket.send(JSON.stringify(transportMessage));
        return; // Wait for transport creation response
      }

      // If rtpParameters are provided (for existing producers), consume directly
      if (rtpParameters) {
        await this.handleConsume(producerId, producerId, kind, rtpParameters);
        return;
      }

      // Otherwise, request consumption from the server
      const consumeMessage = {
        type: 'consume',
        data: {
          roomId: this.roomId,
          peerId: this.peerId,
          producerId,
          rtpCapabilities: this.device.rtpCapabilities,
        },
      };

      this.socket.send(JSON.stringify(consumeMessage));
    } catch (error) {
      console.error('Error consuming stream:', error);
    }
  }

  private async handleConsumerTransportCreation(transportOptions: TransportOptions): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');

    try {
      const transport = await this.device.createRecvTransport({
        id: transportOptions.id,
        iceParameters: transportOptions.iceParameters,
        iceCandidates: transportOptions.iceCandidates,
        dtlsParameters: transportOptions.dtlsParameters,
      });

      transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await this.sendTransportConnect(transport.id, dtlsParameters);
          callback();
        } catch (error) {
          errback(error instanceof Error ? error : new Error('Consumer transport connection failed'));
        }
      });

      this.consumerTransport = transport;
    } catch (error) {
      console.error('Error creating consumer transport:', error);
      throw error;
    }
  }

  private async handleConsume(
    id: string,
    producerId: string,
    kind: string,
    rtpParameters: any
  ): Promise<void> {
    try {
      if (!this.consumerTransport) throw new Error('Consumer transport not created');

      const consumer = await this.consumerTransport.consume({
        id,
        producerId,
        kind: kind as 'audio' | 'video',
        rtpParameters,
      });

      this.consumers.set(consumer.id, consumer);

      // Create a new MediaStream with the consumer's track
      const stream = new MediaStream([consumer.track]);
      this.remoteStreams.set(producerId, stream);

      // Send resume request
      if (this.socket) {
        this.socket.send(JSON.stringify({
          type: 'resumeConsumer',
          data: {
            roomId: this.roomId,
            peerId: this.peerId,
            consumerId: consumer.id,
          },
        }));
      }

      // Notify about the new stream
      this.notifyStreamUpdate();
    } catch (error) {
      console.error('Error handling consume:', error);
    }
  }

  private cleanup(): void {
    console.log('Cleaning up MediasoupService...');
    this.isConnecting = false;
    
    try {
      this.producers.forEach(producer => producer.close());
      this.consumers.forEach(consumer => consumer.close());
      
      this.producerTransports.forEach(transport => {
        transport.close();
      });
      
      if (this.consumerTransport) {
        this.consumerTransport.close();
      }
      
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }

      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      this.remoteStreams.clear();
    } catch (error) {
      console.error('Error during cleanup:', error);
    } finally {
      this.producers.clear();
      this.consumers.clear();
      this.producerTransports.clear();
      this.consumerTransport = null;
      this.device = null;
      this.socket = null;
      this.roomId = null;
      this.peerId = null;
      this.isDeviceLoaded = false;
      this.pendingTransports = {};
    }
  }

  onUserUpdate(callback: (users: User[]) => void): void {
    this.onUserUpdateCallbacks.push(callback);
  }

  onStream(callback: (streams: StreamInfo[]) => void): void {
    this.onStreamCallbacks.push(callback);
    // Send current streams immediately
    this.notifyStreamUpdate();
  }

  private notifyStreamUpdate(): void {
    const streams: StreamInfo[] = [];
    
    // Add local stream if it exists
    if (this.localStream && this.peerId) {
      streams.push({
        peerId: this.peerId,
        stream: this.localStream,
        isLocal: true
      });
    }

    // Add remote streams
    this.remoteStreams.forEach((stream, peerId) => {
      streams.push({
        peerId,
        stream,
        isLocal: false
      });
    });

    // Notify all callbacks
    this.onStreamCallbacks.forEach(callback => callback(streams));
  }

  disconnect(): void {
    this.cleanup();
  }
}

export default new MediasoupService();