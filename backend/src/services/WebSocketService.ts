import { WebSocket, Server as WebSocketServer } from 'ws';
import { types } from 'mediasoup'; // Removed TransportTraceEventType
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
              await this.handleResumeConsumer(ws, data);
              break;
            case 'restartIce':
              await this.handleRestartIce(ws, data);
              break;
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
  
      // Group producers by their peer using transport appData
      const producersByPeer = new Map<string, any[]>();
      
      // First pass: group video producers with known peers
      Array.from(room.producers.entries()).forEach(([id, producer]) => {
        const producerPeer = Array.from(room.peers.values()).find(p =>
          p.transports.some(t => t.transport.appData.producerId === id)
        );
        
        if (producerPeer) {
          if (!producersByPeer.has(producerPeer.id)) {
            producersByPeer.set(producerPeer.id, []);
          }
          producersByPeer.get(producerPeer.id)?.push({
            producerId: id,
            kind: producer.kind
          });
        }
      });
  
      // Second pass: match orphaned audio producers with video peers
      Array.from(room.producers.entries()).forEach(([id, producer]) => {
        if (producer.kind === 'audio') {
          const producerPeer = Array.from(room.peers.values()).find(p =>
            p.transports.some(t => t.transport.appData.producerId === id)
          );
          
          if (!producerPeer) {
            // Find a peer that has a video producer but no audio producer
            for (const [peerId, producers] of producersByPeer) {
              if (!producers.some(p => p.kind === 'audio')) {
                const peer = room.peers.get(peerId);
                if (peer) {
                  producers.push({
                    producerId: id,
                    kind: 'audio'
                  });
                  break;
                }
              }
            }
          }
        }
      });
  
      // Convert grouped producers back to flat array
      const existingProducers = Array.from(producersByPeer.entries()).flatMap(([peerId, producers]) => {
        const peer = room.peers.get(peerId);
        return producers.map(producer => ({
          producerId: producer.producerId,
          peerId,
          username: peer?.username,
          kind: producer.kind
        }));
      });
  
      console.log(existingPeers, existingProducers);
      
      // Notify others about new user
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
        producerPeerId: producerId,
        producerUsername: room.peers.get(producerId)?.username
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

  private async handleRestartIce(ws: WebSocket, data: any) {
    try {
      const { roomId, transportId, forceTurn } = data.data;
      const peerId = (ws as any).socketId; // Get peerId from the WebSocket connection
      
      console.log('Handling ICE restart:', { roomId, peerId, transportId });
      
      const room = this.rooms.get(roomId);
      if (!room) {
        throw new Error(`Room ${roomId} not found`);
      }

      const peer = room.peers.get(peerId);
      if (!peer) {
        throw new Error(`Peer ${peerId} not found in room ${roomId}`);
      }

      const transport = peer.transports.find(t => t.transport.id === transportId);
      if (!transport) {
        throw new Error(`Transport ${transportId} not found for peer ${peerId}`);
      }

      // Restart ICE with forced TURN if requested
      const iceParameters = await transport.transport.restartIce();

      console.log('ICE restarted successfully for transport:', transportId);
      this.send(ws, {
        type: 'iceRestarted',
        data: {
          transportId,
          iceParameters
        }
      });
    } catch (error) {
      console.error('Ice restart error:', error);
      this.sendError(ws, {
        code: 'ICE_RESTART_ERROR',
        message: error instanceof Error ? error.message : 'Unknown ICE restart error',
        transportId: data.data?.transportId
      });
    }
  }
}

export default WebSocketService;