import { WebSocket, Server as WebSocketServer } from 'ws';
import MediasoupService from './MediasoupService';
import { Room } from '../types/mediasoup';
import ActiveUser from '../models/ActiveUser';

export class WebSocketService {
  private wss: WebSocketServer;
  private rooms: Map<string, Room>;

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
            case 'userLogin':
              await this.handleUserLogin(ws, data);
              break;
            case 'getActiveUsers':
              await this.handleGetActiveUsers(ws, data);
              break;
            case 'stopStream':
              await this.handleStopStream(ws, data);
              break;
          }
        } catch (error) {
          this.sendError(ws, error);
        }
      });

      // Handle disconnection
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
      
      // Create peer entry in the room
      if (!room.peers.has(peerId)) {
        room.peers.set(peerId, {
          id: peerId,
          transports: [],
          username,
          isStreaming: false
        });
        console.log(`Created new peer ${peerId} in room ${roomId}`);
      }

      // Store socket ID with the connection
      (ws as any).socketId = peerId;
      (ws as any).roomId = roomId;
      (ws as any).username = username;
      
      // Get all existing peers in the room
      const existingPeers = Array.from(room.peers.values()).map(peer => ({
        peerId: peer.id,
        username: peer.username,
        isStreaming: peer.isStreaming
      }));
      
      // Get all existing producers in the room
      const existingProducers = Array.from(room.producers.entries()).map(([id, producer]) => {
        const producerPeer = Array.from(room.peers.values()).find(p => 
          p.transports.some(t => t.transport.appData.producerId === id)
        );
        return {
          producerId: id,
          peerId: producerPeer?.id,
          username: producerPeer?.username,
          kind: producer.kind
        };
      });

      // Notify other peers about the new user
      this.broadcastToRoom(roomId, {
        type: 'userJoined',
        data: {
          username,
          peerId,
          timestamp: new Date().toISOString()
        }
      }, [peerId]);

      // Send join response with existing peers and producers
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

      console.log(`Peer ${peerId} joined room ${roomId} successfully`);
    } catch (error) {
      console.error('Error handling join:', error);
      this.sendError(ws, error);
    }
  }

  private async handleCreateTransport(ws: WebSocket, data: any) {
    try {
      const { type, roomId, peerId } = data.data;
      
      console.log('Received transport creation request:', {
        type,
        roomId,
        peerId
      });

      // Check if transport already exists
      const room = this.rooms.get(roomId);
      const peer = room?.peers.get(peerId);
      
      if (peer) {
        const existingTransport = peer.transports.find(t => t.type === type);
        if (existingTransport) {
          console.log(`Transport of type ${type} already exists for peer ${peerId}`);
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

  private async handleConnectTransport(ws: WebSocket, data: any) {
    try {
      // The data comes nested inside a data property
      const { roomId, peerId, transportId, dtlsParameters } = data.data;
      
      console.log('Received transport connection request:', {
        roomId,
        peerId,
        transportId,
        dtlsParameters: !!dtlsParameters
      });

      // Validate required fields
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
      console.log('Handling produce request:', { roomId, peerId, transportId, kind });

      const room = MediasoupService.getRooms().get(roomId);
      if (!room) throw new Error(`Room ${roomId} not found`);

      const peer = room.peers.get(peerId);
      if (!peer) throw new Error(`Peer ${peerId} not found`);

      // Update peer streaming status
      peer.isStreaming = true;

      const { producerId, notifyData } = await MediasoupService.createProducer(
        roomId,
        peerId,
        transportId,
        kind,
        rtpParameters
      );

      console.log('Producer created successfully:', { producerId, kind });

      this.send(ws, {
        type: 'produced',
        data: { producerId }
      });

      // Notify all peers about the new producer
      this.broadcastToRoom(roomId, {
        type: 'newProducer',
        data: notifyData
      }, [peerId]);

      // Also notify about streaming status change
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
      console.log('Handling consume request:', { roomId, consumerPeerId, producerId });

      const room = MediasoupService.getRooms().get(roomId);
      if (!room) throw new Error(`Room ${roomId} not found`);

      // Find the producer's peer to get their username
      const producerPeer = Array.from(room.peers.values()).find(peer => 
        peer.transports.some(t => t.transport.appData.producerId === producerId)
      );

      if (!producerPeer) {
        throw new Error('Producer peer not found');
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
          producerUsername: producerPeer.username,
          producerPeerId: producerPeer.id
        }
      });
    } catch (error) {
      console.error('Error handling consume:', error);
      this.sendError(ws, error);
    }
  }

  private async handleUserLogin(ws: WebSocket, data: any) {
    const { username, roomId } = data;
    const socketId = Math.random().toString(36).substring(7);
    (ws as any).socketId = socketId;

    // Create or update active user
    await ActiveUser.findOneAndUpdate(
      { username },
      { 
        socketId, 
        roomId,
        lastActive: new Date() 
      },
      { upsert: true, new: true }
    );

    this.send(ws, {
      type: 'loginSuccess',
      data: { username, socketId }
    });

    // Broadcast updated active users list to clients in the same room
    if (roomId) {
      await this.broadcastActiveUsers(roomId);
    }
  }

  private async handleGetActiveUsers(ws: WebSocket, data: any) {
    const { roomId } = data;
    if (!roomId) {
      return this.sendError(ws, new Error('Room ID is required'));
    }

    const activeUsers = await ActiveUser.find(
      { roomId },
      { username: 1, roomId: 1, _id: 0 }
    );

    this.send(ws, {
      type: 'activeUsers',
      data: { users: activeUsers }
    });
  }

  private async broadcastActiveUsers(roomId: string) {
    const activeUsers = await ActiveUser.find(
      { roomId },
      { username: 1, roomId: 1, _id: 0 }
    );

    // Only broadcast to clients in the same room
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const clientSocketId = (client as any).socketId;
        // Check if client is in the same room
        ActiveUser.findOne({ socketId: clientSocketId, roomId }).then(user => {
          if (user) {
            this.send(client, {
              type: 'activeUsers',
              data: { users: activeUsers }
            });
          }
        });
      }
    });
  }

  private send(ws: WebSocket, message: any) {
    ws.send(JSON.stringify(message));
  }

  private sendError(ws: WebSocket, error: any) {
    this.send(ws, {
      type: 'error',
      message: error.message,
    });
  }

  private async handleStopStream(ws: WebSocket, data: any) {
    const { roomId } = data;
    
    await ActiveUser.findOneAndUpdate(
      { socketId: (ws as any).socketId },
      { hasStream: false }
    );
    
    await this.broadcastActiveUsers(roomId);
  }

  // Add new method to broadcast messages to a specific room
  private async broadcastToRoom(roomId: string, message: any, excludePeerIds: string[] = []) {
    this.wss.clients.forEach(async (client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        const clientSocketId = (client as any).socketId;
        const user = await ActiveUser.findOne({ socketId: clientSocketId, roomId });
        
        if (user && !excludePeerIds.includes(user.username)) {
          this.send(client, message);
        }
      }
    });
  }

  // Add method to handle peer disconnection
  private async handleDisconnection(ws: WebSocket) {
    const peerId = (ws as any).socketId;
    const roomId = (ws as any).roomId;
    const username = (ws as any).username;

    if (roomId && peerId) {
      const room = this.rooms.get(roomId);
      if (room) {
        // Remove peer from room
        const peer = room.peers.get(peerId);
        if (peer) {
          // Clean up peer's producers
          for (const transport of peer.transports) {
            if (transport.transport.appData.producerId) {
              room.producers.delete(transport.transport.appData.producerId);
            }
            await transport.transport.close();
          }
          room.peers.delete(peerId);
        }

        // Notify other peers
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
}

export default WebSocketService; 