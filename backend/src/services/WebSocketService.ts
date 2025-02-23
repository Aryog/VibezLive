import { WebSocket, Server as WebSocketServer } from 'ws';
import MediasoupService from './MediasoupService';
import { Room } from '../types/mediasoup';

export class WebSocketService {
  private wss: WebSocketServer;
  private rooms: Map<string, Room>;
  private producers: Map<string, any> = new Map();

  constructor(server: any) {
    this.wss = new WebSocketServer({ server });
    this.rooms = MediasoupService.getRooms();
    this.init();
  }

  private init() {
    this.wss.on('connection', (ws: WebSocket) => {
      ws.on('message', async (message: string) => {
        const data = JSON.parse(message);
        
        try {
          switch (data.type) {
            case 'join':
              await this.handleJoin(ws, data);
              break;
            case 'createTransport':
              await this.handleCreateTransport(ws, data);
              break;
            case 'connectTransport':
              await this.handleConnectTransport(ws, data);
              break;
            case 'produce':
              await this.handleProduce(ws, data);
              break;
            case 'consume':
              await this.handleConsume(ws, data);
              break;
            case 'resumeConsumer':
              await this.handleResumeConsumer(ws,data);
          }
        } catch (error) {
          this.sendError(ws, error);
        }
      });

      ws.on('close', () => {
        this.handleDisconnection(ws);
      });
    });
  }

  private async handleJoin(ws: WebSocket, data: any) {
    try {
      const { roomId, peerId, username } = data.data;
      console.log('Handling join request:', { roomId, peerId, username });
  
      const room = await MediasoupService.createRoom(roomId);
      
      if (!room.peers.has(peerId)) {
        room.peers.set(peerId, {
          id: peerId,
          transports: [],
          username,
          isStreaming: false
        });
      }
  
      // Store connection metadata
      (ws as any).socketId = peerId;
      (ws as any).roomId = roomId;
      (ws as any).username = username;
      
      const existingPeers = Array.from(room.peers.values()).map(peer => ({
        peerId: peer.id,
        username: peer.username,
        isStreaming: peer.isStreaming
      }));
      
      // Modified to ensure username is always included
      const existingProducers = Array.from(room.producers.entries()).map(([id, producer]) => {
        console.log(producer,id)
        const producerPeer = Array.from(room.peers.values()).find(p => 
          p.transports.some(t => t.transport.appData.producerId === id)
        );
        
        if (!producerPeer) {
          console.warn(`No peer found for producer ${id}`);
          return null;
        }
  
        return {
          producerId: id,
          peerId: producerPeer.id,
          username: producerPeer.username,
          kind: producer.kind
        };
      }).filter(Boolean); // Remove null entries
  
      // Rest of the join handling code...
      this.broadcastToRoom(roomId, {
        type: 'userJoined',
        data: {
          username,
          peerId,
          timestamp: new Date().toISOString()
        }
      }, [peerId]);
  
      this.send(ws, {
        type: 'joined',
        data: {
          roomId,
          peerId,
          routerRtpCapabilities: room.router.rtpCapabilities,
          existingPeers,
          existingProducers
        },
      });
    } catch (error) {
      console.error('Error handling join:', error);
      this.sendError(ws, error);
    }
  }

  private async handleCreateTransport(ws: WebSocket, data: any) {
    try {
      const { type, roomId, peerId } = data.data;
      
      const room = this.rooms.get(roomId);
      const peer = room?.peers.get(peerId);
      
      if (peer) {
        const existingTransport = peer.transports.find(t => t.type === type);
        if (existingTransport) {
          return this.send(ws, {
            type: 'transportCreated',
            data: {
              id: existingTransport.transport.id,
              iceParameters: existingTransport.transport.iceParameters,
              iceCandidates: existingTransport.transport.iceCandidates,
              dtlsParameters: existingTransport.transport.dtlsParameters,
            }
          });
        }
      }

      const transport = await MediasoupService.createWebRtcTransport(roomId, peerId, type);
      
      this.send(ws, {
        type: 'transportCreated',
        data: transport,
      });
    } catch (error) {
      console.error('Transport creation error:', error);
      this.sendError(ws, error);
    }
  }

  private async handleResumeConsumer(ws: WebSocket, data: any) {
    try {
      const { roomId, consumerId } = data.data;
      const room = this.rooms.get(roomId);
      if (!room) throw new Error(`Room ${roomId} not found`);

      const consumer = room.consumers.get(consumerId);
      if (!consumer) throw new Error(`Consumer ${consumerId} not found`);

      await consumer.resume();
      
      this.send(ws, {
        type: 'consumerResumed',
        data: { consumerId }
      });
    } catch (error) {
      console.error('Error resuming consumer:', error);
      this.sendError(ws, error);
    }
  }

  private async handleConnectTransport(ws: WebSocket, data: any) {
    try {
      const { roomId, peerId, transportId, dtlsParameters } = data.data;
      
      if (!roomId || !peerId || !transportId || !dtlsParameters) {
        throw new Error('Missing required fields for transport connection');
      }

      const room = this.rooms.get(roomId);
      if (!room) throw new Error('Room not found');

      const peer = room.peers.get(peerId);
      if (!peer) throw new Error('Peer not found');

      const transport = peer.transports.find(t => t.transport.id === transportId);
      if (!transport) throw new Error('Transport not found');

      await transport.transport.connect({ dtlsParameters });
      
      this.send(ws, {
        type: 'transportConnected',
        data: { transportId }
      });
    } catch (error) {
      console.error('Transport connection error:', error);
      this.sendError(ws, error);
    }
  }

  private async handleProduce(ws: WebSocket, data: any) {
  try {
    const { roomId, peerId, transportId, kind, rtpParameters } = data.data;
    
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    const peer = room.peers.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found`);

    const { producerId, notifyData } = await MediasoupService.createProducer(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters
    );

    // Store producer with peer info
    this.producers.set(producerId, {
      peerId,
      kind,
      username: peer.username
    });

    this.send(ws, {
      type: 'produced',
      data: { producerId }
    });

    // Notify other peers with complete peer info
    this.broadcastToRoom(roomId, {
      type: 'newProducer',
      data: {
        ...notifyData,
        username: peer.username
      }
    }, [peerId]);

    // Broadcast streaming status change
    this.broadcastToRoom(roomId, {
      type: 'peerStreamingStatusChanged',
      data: {
        peerId,
        username: peer.username,
        isStreaming: true
      }
    });
  } catch (error) {
    console.error('Error handling produce:', error);
    this.sendError(ws, error);
  }
}

private async handleConsume(ws: WebSocket, data: any) {
  try {
    const { roomId, consumerPeerId, producerId, rtpCapabilities } = data.data;
    
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);

    // Get producer info from our stored map
    const producerInfo = this.producers.get(producerId);
    if (!producerInfo) {
      throw new Error(`Producer info not found: ${producerId}`);
    }

    // Get producer's peer
    const producerPeer = room.peers.get(producerInfo.peerId);
    if (!producerPeer) {
      throw new Error(`Producer peer not found: ${producerInfo.peerId}`);
    }

    const consumerData = await MediasoupService.createConsumer(
      roomId,
      consumerPeerId,
      producerId,
      rtpCapabilities
    );

    this.send(ws, {
      type: 'consumed',
      data: {
        ...consumerData,
        producerPeerId: producerInfo.peerId,
        producerUsername: producerPeer.username
      }
    });
  } catch (error) {
    console.error('Error handling consume:', error);
    this.sendError(ws, error);
  }
}

  private async handleDisconnection(ws: WebSocket) {
    const peerId = (ws as any).socketId;
    const roomId = (ws as any).roomId;
    const username = (ws as any).username;

    if (roomId && peerId) {
      const room = this.rooms.get(roomId);
      if (room) {
        const peer = room.peers.get(peerId);
        if (peer) {
          // Cleanup producers and transports
          for (const transport of peer.transports) {
            if (transport.transport.appData.producerId) {
              const producerId = transport.transport.appData.producerId;
              room.producers.delete(producerId);
              this.producers.delete(producerId);
            }
            await transport.transport.close();
          }
          room.peers.delete(peerId);
        }

        this.broadcastToRoom(roomId, {
          type: 'userLeft',
          data: {
            username,
            peerId,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }

  private send(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: any) {
    this.send(ws, {
      type: 'error',
      message: error.message,
    });
  }

  private broadcastToRoom(roomId: string, message: any, excludePeerIds: string[] = []) {
    this.wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        const clientPeerId = (client as any).socketId;
        const clientRoomId = (client as any).roomId;
        
        if (clientRoomId === roomId && !excludePeerIds.includes(clientPeerId)) {
          this.send(client, message);
        }
      }
    });
  }
}

export default WebSocketService;