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
      ws.on('close', async () => {
        try {
          const user = await ActiveUser.findOne({ socketId: (ws as any).socketId });
          if (user) {
            const roomId = user.roomId;
            const username = user.username;
            
            await ActiveUser.deleteOne({ socketId: (ws as any).socketId });
            
            if (roomId) {
              // Broadcast user left notification
              await this.broadcastToRoom(roomId, {
                type: 'userLeft',
                data: {
                  username,
                  timestamp: new Date().toISOString()
                }
              });
              
              await this.broadcastActiveUsers(roomId);
            }
          }
        } catch (error) {
          console.error('Error handling disconnection:', error);
        }
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
          transports: []
        });
        console.log(`Created new peer ${peerId} in room ${roomId}`);
      }
      
      // Update user's room when they join
      if (username) {
        await ActiveUser.findOneAndUpdate(
          { socketId: (ws as any).socketId },
          { roomId },
          { new: true }
        );
        
        // Broadcast updated user list for this room
        await this.broadcastActiveUsers(roomId);

        // Broadcast join notification to all users in the room
        await this.broadcastToRoom(roomId, {
          type: 'userJoined',
          data: {
            username,
            timestamp: new Date().toISOString()
          }
        });
      }
      
      this.send(ws, {
        type: 'joined',
        data: {
          roomId,
          peerId,
          routerRtpCapabilities: room.router.rtpCapabilities,
        },
      });

      // Notify the new peer about existing producers
      await this.notifyExistingProducers(ws, roomId, peerId);

      console.log(`Peer ${peerId} joined room ${roomId} successfully`);
    } catch (error) {
      console.error('Error handling join:', error);
      this.sendError(ws, error);
    }
  }

  private async handleCreateTransport(ws: WebSocket, data: any) {
    try {
      // The data comes nested inside a data property
      const { type, roomId, peerId } = data.data;
      
      console.log('Received transport creation request:', {
        type,
        roomId,
        peerId
      });

      // Validate required fields
      if (!roomId || !peerId || !type) {
        throw new Error(`Missing required fields for transport creation. Received: type=${type}, roomId=${roomId}, peerId=${peerId}`);
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

      const room = this.rooms.get(roomId);
      if (!room) throw new Error('Room not found');

      const peer = room.peers.get(peerId);
      if (!peer) {
        console.error(`Peer ${peerId} not found in room ${roomId}`);
        console.log('Current peers:', Array.from(room.peers.keys()));
        throw new Error('Peer not found');
      }

      const producerId = await MediasoupService.createProducer(
        roomId,
        peerId,
        transportId,
        kind,
        rtpParameters
      );
      
      // Update user's streaming status when they produce video
      if (kind === 'video') {
        await ActiveUser.findOneAndUpdate(
          { socketId: (ws as any).socketId },
          { hasStream: true }
        );
        await this.broadcastActiveUsers(roomId);
      }
      
      this.send(ws, {
        type: 'produced',
        data: { producerId }
      });

      // Notify all other peers in the room about the new producer
      this.notifyNewProducer(roomId, peerId, producerId);

      console.log(`Producer ${producerId} created for peer ${peerId}`);
    } catch (error) {
      console.error('Error handling produce:', error);
      this.sendError(ws, error);
    }
  }

  private async notifyNewProducer(roomId: string, producerPeerId: string, producerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Send notification to all peers except the producer
    this.wss.clients.forEach(async (client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        const clientSocketId = (client as any).socketId;
        const user = await ActiveUser.findOne({ socketId: clientSocketId });
        
        if (user && user.roomId === roomId) {
          const peer = room.peers.get(user.username);
          if (peer && peer.id !== producerPeerId) {
            this.send(client, {
              type: 'newProducer',
              data: {
                producerId,
                producerPeerId
              }
            });
          }
        }
      }
    });
  }

  // Add this method to notify new peers about existing producers
  private async notifyExistingProducers(ws: WebSocket, roomId: string, peerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Send all existing producers to the new peer
    for (const [producerId, producer] of room.producers) {
      const producerPeer = Array.from(room.peers.values()).find(p => 
        p.transports.some(t => t.transport.appData.producerId === producerId)
      );

      if (producerPeer && producerPeer.id !== peerId) {
        this.send(ws, {
          type: 'newProducer',
          data: {
            producerId,
            producerPeerId: producerPeer.id
          }
        });
      }
    }
  }

  private async handleConsume(ws: WebSocket, data: any) {
    const { roomId, consumerPeerId, producerId, rtpCapabilities } = data;
    const consumerData = await MediasoupService.createConsumer(
      roomId,
      consumerPeerId,
      producerId,
      rtpCapabilities
    );
    
    this.send(ws, {
      type: 'consumed',
      data: consumerData
    });
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
  private async broadcastToRoom(roomId: string, message: any) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const clientSocketId = (client as any).socketId;
        // Check if client is in the same room
        ActiveUser.findOne({ socketId: clientSocketId, roomId }).then(user => {
          if (user) {
            this.send(client, message);
          }
        });
      }
    });
  }
}

export default WebSocketService; 