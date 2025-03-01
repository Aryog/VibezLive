import {
  Worker,
  Router,
  WebRtcTransport,
  WebRtcTransportOptions,
  Producer,
  Consumer,
  RtpCapabilities,
  DtlsParameters,
  RtpParameters,
} from "mediasoup/node/lib/types";
import { createWorker } from "mediasoup";
import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { mediasoupConfig } from "../config/mediasoup.config";
import Room from "../models/Room";
import ActiveUser from "../models/ActiveUser";

interface Peer {
  id: string;
  socket: WebSocket;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  rtpCapabilities?: RtpCapabilities;
  kindTransports: Map<string, string>;
}

interface JoinRoomParams {
  roomId: string;
  peerId: string;
  rtpCapabilities: RtpCapabilities;
}

interface CreateTransportParams {
  roomId: string;
  peerId: string;
  direction?: "send" | "recv";
  appData?: Record<string, any>;
  kind: "audio" | "video";
}

interface ConnectTransportParams {
  peerId: string;
  transportId: string;
  dtlsParameters: DtlsParameters;
}

interface ProduceParams {
  peerId: string;
  transportId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  roomId: string;
  appData?: Record<string, any>;
}

interface ConsumeParams {
  peerId: string;
  producerId: string;
  roomId: string;
  rtpCapabilities: RtpCapabilities;
  transportId: string;
}

interface ResumeConsumerParams {
  peerId: string;
  consumerId: string;
}

interface LeaveRoomParams {
  peerId: string;
  roomId: string;
}

interface TransportCreationResult {
  transport: WebRtcTransport;
  params: {
    id: string;
    iceParameters: any;
    iceCandidates: any;
    dtlsParameters: any;
  };
}

interface ProducerInfo {
  id: string;
  kind: string;
  peerId: string;
}

interface ConsumerCreationResult {
  id: string;
  producerId: string;
  producerPeerId: string;
  kind: "audio" | "video";
  rtpParameters: RtpParameters;
  type: string;
  transportId: string;
}

class MediasoupService {
  private static instance: MediasoupService;
  private worker: Worker | null = null;
  private routers: Map<string, Router> = new Map(); // roomId -> Router
  private peers: Map<string, Peer> = new Map(); // peerId -> Peer
  private rooms: Map<string, Set<string>> = new Map(); // roomId -> Set of peerIds

  constructor() {
    if (MediasoupService.instance) {
      return MediasoupService.instance;
    }
    MediasoupService.instance = this;
  }

  async createWorker(): Promise<Worker> {
    try {
      this.worker = await createWorker({
        logLevel: mediasoupConfig.worker.logLevel as any,
        logTags: mediasoupConfig.worker.logTags as any,
        rtcMinPort: mediasoupConfig.worker.rtcMinPort,
        rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
      });

      console.log("Mediasoup worker created");

      this.worker.on("died", () => {
        console.error("Mediasoup worker died, exiting in 2 seconds...");
        setTimeout(() => process.exit(1), 2000);
      });

      return this.worker;
    } catch (error) {
      console.error("Error creating mediasoup worker:", error);
      throw error;
    }
  }

  async createRouter(roomId: string): Promise<Router> {
    if (!this.worker) {
      await this.createWorker();
    }

    try {
      if (!this.worker) {
        throw new Error("Worker not initialized");
      }

      const router = await this.worker.createRouter({
        mediaCodecs: mediasoupConfig.router.mediaCodecs,
      });

      this.routers.set(roomId, router);
      console.log(`Router created for room ${roomId}`);

      return router;
    } catch (error) {
      console.error(`Error creating router for room ${roomId}:`, error);
      throw error;
    }
  }

  async getOrCreateRouter(roomId: string): Promise<Router> {
    let router = this.routers.get(roomId);
    if (!router) {
      router = await this.createRouter(roomId);
    }
    return router;
  }

  async createWebRtcTransport(
    router: Router,
    peerId: string,
    transportOptions: Partial<WebRtcTransportOptions> = {},
    kind: "audio" | "video"
  ): Promise<{ transport: WebRtcTransport; params: any }> {
    try {
      // Base configuration with common settings
      const baseOptions = {
        ...transportOptions,
        listenIps: mediasoupConfig.webRtcTransport.listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate:
          mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
      };
  
      // Create transport with the proper type configuration
      let transportConfig: WebRtcTransportOptions;
      
      if (kind === "audio") {
        transportConfig = {
          ...baseOptions,
          initialAvailableOutgoingBitrate: 
            mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate.audio || 
            mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
          // Audio-specific options
          maxIncomingBitrate: mediasoupConfig.webRtcTransport.maxIncomingBitrate?.audio,
          // You can add other audio-specific parameters here
        } as unknown as WebRtcTransportOptions;
      } else { // kind === "video"
        transportConfig = {
          ...baseOptions,
          initialAvailableOutgoingBitrate: 
            mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate.video || 
            mediasoupConfig.webRtcTransport.initialAvailableOutgoingBitrate,
          // Video-specific options - typically needs higher bitrates
          maxIncomingBitrate: mediasoupConfig.webRtcTransport.maxIncomingBitrate?.video,
          // You can add other video-specific parameters here
        } as unknown as WebRtcTransportOptions;
      }
  
      // After creating the transport, we can modify properties that aren't part of the creation options
      const transport = await router.createWebRtcTransport(transportConfig);
      
      // Set max bitrates after transport creation
      if (kind === "audio" && mediasoupConfig.webRtcTransport.maxIncomingBitrate?.audio) {
        await transport.setMaxIncomingBitrate(mediasoupConfig.webRtcTransport.maxIncomingBitrate.audio);
      } else if (kind === "video" && mediasoupConfig.webRtcTransport.maxIncomingBitrate?.video) {
        await transport.setMaxIncomingBitrate(mediasoupConfig.webRtcTransport.maxIncomingBitrate.video);
      }
      
      // Store the transport with its kind
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.transports.set(transport.id, transport);
        
        // Optionally track the kind of transport for later reference
        if (!peer.kindTransports) {
          peer.kindTransports = new Map();
        }
        peer.kindTransports.set(kind, transport.id);
      }
  
      // Set transport event handlers
      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          console.log(`${kind} transport ${transport.id} closed`);
          this.closeTransport(peerId, transport.id);
        } else if (dtlsState === "connected") {
          console.log(`${kind} transport ${transport.id} DTLS connected`);
          
          // Notify peer that transport is connected (DTLS handshake complete)
          const peer = this.peers.get(peerId);
          if (peer && peer.socket) {
            peer.socket.send(
              JSON.stringify({
                type: "transportConnected",
                data: {
                  transportId: transport.id,
                  kind: kind,
                  dtlsState: dtlsState
                }
              })
            );
          }
        }
      });
  
      transport.on("@close", () => {
        console.log(`${kind} transport ${transport.id} closed`);
      });
  
      return {
        transport,
        params: {
          id: transport.id,
          kind: kind,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      };
    } catch (error) {
      console.error(`Error creating ${kind} WebRTC transport:`, error);
      throw error;
    }
  }

  async connectTransport(
    peerId: string,
    transportId: string,
    dtlsParameters: DtlsParameters
  ): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} not found`);
    }

    const transport = peer.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    try {
      await transport.connect({ dtlsParameters });
      console.log(`Transport ${transportId} connection initiated`);
      
      // The DTLS connection result will be emitted through the "dtlsstatechange" event
      // that we're listening to in the createWebRtcTransport method
    } catch (error) {
      console.error(`Error connecting transport ${transportId}:`, error);
      throw error;
    }
  }

  async createProducer(
    peerId: string,
    transportId: string,
    producerOptions: {
      kind: "audio" | "video";
      rtpParameters: RtpParameters;
      appData?: Record<string, any>;
    }
  ): Promise<{ id: string }> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} not found`);
    }

    const transport = peer.transports.get(transportId);
    if (!transport) {
      throw new Error(`Transport ${transportId} not found`);
    }

    try {
      const { kind, rtpParameters, appData } = producerOptions;
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData,
      });

      peer.producers.set(producer.id, producer);

      producer.on("transportclose", () => {
        console.log(`Producer ${producer.id} transport closed`);
        this.removeProducer(peerId, producer.id);
      });

      producer.on("@close", () => {
        console.log(`Producer ${producer.id} closed`);
        this.removeProducer(peerId, producer.id);
      });

      // Broadcast to all consumers in the room
      if (appData && appData.roomId) {
        this.broadcastNewProducer(peerId, producer, appData.roomId);
      }

      return { id: producer.id };
    } catch (error) {
      console.error("Error creating producer:", error);
      throw error;
    }
  }

  async createConsumer(
    peerId: string,
    producerId: string,
    roomId: string,
    rtpCapabilities: RtpCapabilities,
    transportId: string
  ): Promise<ConsumerCreationResult> {
    const router = this.routers.get(roomId);
    if (!router) {
      throw new Error(`Router for room ${roomId} not found`);
    }

    // Find producer owner
    let producerOwner: Peer | undefined;
    let foundProducer: Producer | undefined;

    for (const [pid, peer] of this.peers.entries()) {
      const producer = peer.producers.get(producerId);
      if (producer) {
        producerOwner = peer;
        foundProducer = producer;
        break;
      }
    }

    if (!producerOwner || !foundProducer) {
      throw new Error(`Producer ${producerId} not found`);
    }

    // Consumer peer
    const consumerPeer = this.peers.get(peerId);
    if (!consumerPeer) {
      throw new Error(`Consumer peer ${peerId} not found`);
    }

    // Check if the peer can consume the producer
    if (
      !router.canConsume({
        producerId: foundProducer.id,
        rtpCapabilities,
      })
    ) {
      throw new Error(`Peer ${peerId} cannot consume producer ${producerId}`);
    }

    try {
      // Use the specified transport
      const consumerTransport = consumerPeer.transports.get(transportId);
      if (!consumerTransport) {
        throw new Error(`Transport ${transportId} not found for consumer`);
      }

      // Create the consumer
      const consumer = await consumerTransport.consume({
        producerId: foundProducer.id,
        rtpCapabilities,
        paused: true, // Start paused by default
      });

      // Store the consumer
      consumerPeer.consumers.set(consumer.id, consumer);

      consumer.on("transportclose", () => {
        console.log(`Consumer ${consumer.id} transport closed`);
        this.removeConsumer(peerId, consumer.id);
      });

      consumer.on("producerclose", () => {
        console.log(`Consumer ${consumer.id} producer closed`);
        this.removeConsumer(peerId, consumer.id);
        
        // Notify the client that the producer is closed
        const peer = this.peers.get(peerId);
        if (peer && peer.socket) {
          peer.socket.send(
            JSON.stringify({
              type: "producerClosed",
              data: {
                consumerId: consumer.id,
                producerId: foundProducer.id,
              },
            })
          );
        }
      });

      consumer.on("@close", () => {
        console.log(`Consumer ${consumer.id} closed`);
        this.removeConsumer(peerId, consumer.id);
      });

      const consumerResult: ConsumerCreationResult = {
        id: consumer.id,
        producerId: foundProducer.id,
        producerPeerId: producerOwner.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        transportId: consumerTransport.id,
      };

      return consumerResult;
    } catch (error) {
      console.error("Error creating consumer:", error);
      throw error;
    }
  }

  async resumeConsumer(peerId: string, consumerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer ${peerId} not found`);
    }

    const consumer = peer.consumers.get(consumerId);
    if (!consumer) {
      throw new Error(`Consumer ${consumerId} not found`);
    }

    await consumer.resume();
    console.log(`Consumer ${consumerId} resumed`);
  }

  async broadcastNewProducer(
    peerId: string,
    producer: Producer,
    roomId: string
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.warn(`Room ${roomId} not found when broadcasting new producer`);
      return;
    }

    const peer = this.peers.get(peerId);
    if (!peer) {
      console.warn(`Peer ${peerId} not found when broadcasting new producer`);
      return;
    }

    const producerInfo: ProducerInfo = {
      id: producer.id,
      kind: producer.kind,
      peerId: peerId,
    };

    // Broadcast to all peers in the room except the producer
    for (const memberId of room) {
      if (memberId !== peerId) {
        const member = this.peers.get(memberId);
        if (member && member.socket) {
          member.socket.send(
            JSON.stringify({
              type: "newProducer",
              data: producerInfo,
            })
          );
        }
      }
    }
  }

  removeProducer(peerId: string, producerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const producer = peer.producers.get(producerId);
    if (!producer) return;

    producer.close();
    peer.producers.delete(producerId);
  }

  removeConsumer(peerId: string, consumerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const consumer = peer.consumers.get(consumerId);
    if (!consumer) return;

    consumer.close();
    peer.consumers.delete(consumerId);
  }

  closeTransport(peerId: string, transportId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    const transport = peer.transports.get(transportId);
    if (!transport) return;

    transport.close();
    peer.transports.delete(transportId);
  }

  async handlePeerLeave(peerId: string, roomId: string): Promise<void> {
    console.log(`Peer ${peerId} leaving room ${roomId}`);

    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Close all producers
    for (const producer of peer.producers.values()) {
      producer.close();
    }

    // Close all consumers
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }

    // Close all transports
    for (const transport of peer.transports.values()) {
      transport.close();
    }

    // Remove peer from room
    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(peerId);

      // If room is empty, close the router and remove the room
      if (room.size === 0) {
        const router = this.routers.get(roomId);
        if (router) {
          router.close();
          this.routers.delete(roomId);
        }
        this.rooms.delete(roomId);
        console.log(`Room ${roomId} closed due to no participants`);
      } else {
        // Broadcast to remaining peers that this peer has left
        this.broadcastPeerLeft(peerId, roomId);
      }
    }

    // Remove peer from peers map
    this.peers.delete(peerId);

    // Update active user status in database
    try {
      await ActiveUser.findOneAndUpdate(
        { userId: peerId },
        { isActive: false, roomId: null },
        { new: true }
      );
    } catch (error) {
      console.error(`Error updating active user status for ${peerId}:`, error);
    }
  }

  broadcastPeerLeft(peerId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Notify all peers in the room that this peer has left
    for (const memberId of room) {
      if (memberId !== peerId) {
        const member = this.peers.get(memberId);
        if (member && member.socket) {
          member.socket.send(
            JSON.stringify({
              type: "peerLeft",
              data: { peerId },
            })
          );
        }
      }
    }
  }

  async joinRoom(
    socket: WebSocket,
    { roomId, peerId, rtpCapabilities }: JoinRoomParams
  ): Promise<{
    routerRtpCapabilities: RtpCapabilities;
    existingPeers: { id: string }[];
    existingProducers: ProducerInfo[];
  }> {
    console.log(`Peer ${peerId} joining room ${roomId}`);

    // Create room if it doesn't exist
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }

    // Add peer to room
    const room = this.rooms.get(roomId);
    if (room) {
      room.add(peerId);
    }

    // Create peer object if it doesn't exist
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, {
        id: peerId,
        socket,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        kindTransports: new Map(),
      });
    } else {
      // Update socket reference if peer already exists
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.socket = socket;
      }
    }

    // Get or create router for this room
    const router = await this.getOrCreateRouter(roomId);

    // Get router RTP capabilities
    const routerRtpCapabilities = router.rtpCapabilities;

    // Update active user status in database
    try {
      await ActiveUser.findOneAndUpdate(
        { userId: peerId },
        { isActive: true, roomId },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error updating active user status for ${peerId}:`, error);
    }

    // Update room participant count
    try {
      await Room.findByIdAndUpdate(roomId, { $inc: { participantCount: 1 } });
    } catch (error) {
      console.error(
        `Error updating room participant count for ${roomId}:`,
        error
      );
    }

    // Notify all existing peers in the room about the new peer
    if (room) {
      for (const memberId of room) {
        if (memberId !== peerId) {
          const member = this.peers.get(memberId);
          if (member && member.socket) {
            member.socket.send(
              JSON.stringify({
                type: "newPeer",
                data: { peerId },
              })
            );
          }
        }
      }
    }

    // Send list of peers already in the room to the new peer
    const existingPeers: { id: string }[] = [];
    if (room) {
      for (const memberId of room) {
        if (memberId !== peerId) {
          existingPeers.push({ id: memberId });
        }
      }
    }

    // Get existing producers in the room
    const existingProducers: ProducerInfo[] = [];
    for (const memberId of room || []) {
      if (memberId !== peerId) {
        const member = this.peers.get(memberId);
        if (member) {
          for (const [producerId, producer] of member.producers) {
            existingProducers.push({
              id: producerId,
              kind: producer.kind,
              peerId: memberId,
            });
          }
        }
      }
    }

    // Store the RTP capabilities for this peer
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.rtpCapabilities = rtpCapabilities;
    }

    return {
      routerRtpCapabilities,
      existingPeers,
      existingProducers
    };
  }

  static initializeWebSocket(httpServer: Server): WebSocketServer {
    const mediasoupService = new MediasoupService();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on("connection", (socket: WebSocket) => {
      console.log("New WebSocket connection");

      socket.on("message", async (message: string) => {
        try {
          const { type, data } = JSON.parse(message);
          let response;

          switch (type) {
            case "joinRoom":
              response = await mediasoupService.joinRoom(
                socket,
                data as JoinRoomParams
              );
              socket.send(
                JSON.stringify({
                  type: "joinRoomResponse",
                  data: response,
                })
              );
              break;

            case "setRtpCapabilities":
              try {
                const router = mediasoupService.routers.get(data.roomId);
                if (!router) {
                  throw new Error(`Router for room ${data.roomId} not found`);
                }
                // Store the RTP capabilities for this peer
                const peer = mediasoupService.peers.get(data.peerId);
                if (peer) {
                  peer.rtpCapabilities = data.rtpCapabilities;
                }
                socket.send(
                  JSON.stringify({
                    type: "rtpCapabilitiesSet",
                    data: { success: true }
                  })
                );
              } catch (error) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    data: { message: error instanceof Error ? error.message : "Unknown error" }
                  })
                );
              }
              break;

            case "createWebRtcTransport":
              try {
                const router = mediasoupService.routers.get(
                  (data as CreateTransportParams).roomId
                );
                if (!router) {
                  throw new Error(
                    `Router for room ${
                      (data as CreateTransportParams).roomId
                    } not found`
                  );
                }

                // Use the direction to set appropriate appData
                const direction = (data as CreateTransportParams).direction || "send";
                const appData = {
                  ...(data as CreateTransportParams).appData,
                  producing: direction === "send",
                  consuming: direction === "recv",
                };

                const { transport, params } =
                  await mediasoupService.createWebRtcTransport(
                    router,
                    (data as CreateTransportParams).peerId,
                    { appData },
                    (data as CreateTransportParams).kind
                  );

                socket.send(
                  JSON.stringify({
                    type: "createWebRtcTransportResponse",
                    data: {
                      transportOptions: params,
                      direction
                    },
                  })
                );
              } catch (error) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    data: { 
                      message: error instanceof Error ? error.message : "Unknown error",
                      context: "createWebRtcTransport"
                    }
                  })
                );
              }
              break;

            case "connectTransport":
              try {
                await mediasoupService.connectTransport(
                  (data as ConnectTransportParams).peerId,
                  (data as ConnectTransportParams).transportId,
                  (data as ConnectTransportParams).dtlsParameters
                );

                socket.send(
                  JSON.stringify({
                    type: "connectTransportResponse",
                    data: { 
                      connected: true,
                      transportId: (data as ConnectTransportParams).transportId
                    },
                  })
                );
              } catch (error) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    data: { 
                      message: error instanceof Error ? error.message : "Unknown error",
                      context: "connectTransport",
                      transportId: (data as ConnectTransportParams).transportId
                    }
                  })
                );
              }
              break;

            case "produce":
              try {
                const { id } = await mediasoupService.createProducer(
                  (data as ProduceParams).peerId,
                  (data as ProduceParams).transportId,
                  {
                    kind: (data as ProduceParams).kind,
                    rtpParameters: (data as ProduceParams).rtpParameters,
                    appData: {
                      roomId: (data as ProduceParams).roomId,
                      ...(data as ProduceParams).appData,
                    },
                  }
                );

                socket.send(
                  JSON.stringify({
                    type: "produceResponse",
                    data: { 
                      id,
                      kind: (data as ProduceParams).kind
                    },
                  })
                );
              } catch (error) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    data: { 
                      message: error instanceof Error ? error.message : "Unknown error",
                      context: "produce"
                    }
                  })
                );
              }
              break;

            case "consume":
              try {
                const params = data as ConsumeParams;
                const consumerData = await mediasoupService.createConsumer(
                  params.peerId,
                  params.producerId,
                  params.roomId,
                  params.rtpCapabilities,
                  params.transportId
                );

                socket.send(
                  JSON.stringify({
                    type: "consumeResponse",
                    data: consumerData,
                  })
                );
              } catch (error) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    data: { 
                      message: error instanceof Error ? error.message : "Unknown error",
                      context: "consume",
                      producerId: (data as ConsumeParams).producerId
                    }
                  })
                );
              }
              break;

            case "resumeConsumer":
              try {
                await mediasoupService.resumeConsumer(
                  (data as ResumeConsumerParams).peerId,
                  (data as ResumeConsumerParams).consumerId
                );

                socket.send(
                  JSON.stringify({
                    type: "resumeConsumerResponse",
                    data: { 
                      resumed: true,
                      consumerId: (data as ResumeConsumerParams).consumerId
                    },
                  })
                );
              } catch (error) {
                socket.send(
                  JSON.stringify({
                    type: "error",
                    data: { 
                      message: error instanceof Error ? error.message : "Unknown error",
                      context: "resumeConsumer",
                      consumerId: (data as ResumeConsumerParams).consumerId
                    }
                  })
                );
              }
              break;

            case "getProducers":
              // Get all producers in the specified room
              const roomProducers: ProducerInfo[] = [];
              const roomPeers = mediasoupService.rooms.get(data.roomId);

              if (roomPeers) {
                for (const memberId of roomPeers) {
                  if (memberId !== data.peerId) {
                    const peer = mediasoupService.peers.get(memberId);
                    if (peer) {
                      for (const [producerId, producer] of peer.producers) {
                        roomProducers.push({
                          id: producerId,
                          kind: producer.kind,
                          peerId: memberId,
                        });
                      }
                    }
                  }
                }
              }

              socket.send(
                JSON.stringify({
                  type: "getProducersResponse",
                  data: { producers: roomProducers },
                })
              );
              break;

            case "leaveRoom":
              await mediasoupService.handlePeerLeave(
                (data as LeaveRoomParams).peerId,
                (data as LeaveRoomParams).roomId
              );

              socket.send(
                JSON.stringify({
                  type: "leaveRoomResponse",
                  data: { left: true },
                })
              );
              break;

            default:
              console.warn(`Unknown message type: ${type}`);
          }
        } catch (error) {
          console.error("Error handling WebSocket message:", error);
          socket.send(
            JSON.stringify({
              type: "error",
              data: {
                message:
                  error instanceof Error ? error.message : "Unknown error",
              },
            })
          );
        }
      });

      socket.on("close", async () => {
        console.log("WebSocket connection closed");
        // Find the peer associated with this socket and handle disconnection
        for (const [peerId, peer] of mediasoupService.peers.entries()) {
          if (peer.socket === socket) {
            // Find which room this peer is in
            for (const [
              roomId,
              roomPeers,
            ] of mediasoupService.rooms.entries()) {
              if (roomPeers.has(peerId)) {
                await mediasoupService.handlePeerLeave(peerId, roomId);
                break;
              }
            }
            break;
          }
        }
      });
    });

    return wss;
  }
}

export default MediasoupService;