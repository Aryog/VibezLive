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
          }
        } catch (error) {
          this.sendError(ws, error);
        }
      });

      // Handle disconnection
      ws.on('close', async () => {
        try {
          // Remove user from active users when they disconnect
          await ActiveUser.deleteOne({ socketId: (ws as any).socketId });
          this.broadcastActiveUsers((ws as any).roomId);
        } catch (error) {
          console.error('Error handling disconnection:', error);
        }
      });
    });
  }

  private async handleJoin(ws: WebSocket, data: any) {
    const { roomId, peerId, username } = data;
    const room = await MediasoupService.createRoom(roomId);
    
    // Update user's room when they join
    if (username) {
      await ActiveUser.findOneAndUpdate(
        { socketId: (ws as any).socketId },
        { roomId },
        { new: true }
      );
      
      // Broadcast updated user list for this room
      await this.broadcastActiveUsers(roomId);
    }
    
    this.send(ws, {
      type: 'joined',
      data: {
        roomId,
        peerId,
        routerRtpCapabilities: room.router.rtpCapabilities,
      },
    });
  }

  private async handleCreateTransport(ws: WebSocket, data: any) {
    const { roomId, peerId, type } = data;
    const transport = await MediasoupService.createWebRtcTransport(roomId, peerId, type);
    
    this.send(ws, {
      type: 'transportCreated',
      data: transport,
    });
  }

  private async handleConnectTransport(ws: WebSocket, data: any) {
    const { roomId, peerId, transportId, dtlsParameters } = data;
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
  }

  private async handleProduce(ws: WebSocket, data: any) {
    const { roomId, peerId, transportId, kind, rtpParameters } = data;
    const producerId = await MediasoupService.createProducer(
      roomId,
      peerId,
      transportId,
      kind,
      rtpParameters
    );
    
    this.send(ws, {
      type: 'produced',
      data: { producerId }
    });
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
}

export default WebSocketService; 