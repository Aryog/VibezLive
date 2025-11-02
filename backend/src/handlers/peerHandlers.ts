import { Server, Socket } from 'socket.io';
import { Room } from '../room.js';

export class PeerHandlers {
  constructor(
    private io: Server,
    private rooms: Map<string, Room>,
    private userRooms: Map<string, string>
  ) {}

  handleDisconnect(socket: Socket) {
    console.log('client disconnected', socket.id);
    
    const roomId = this.userRooms.get(socket.id);
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) {
        console.log(`Cleaning up resources for peer ${socket.id} in room ${roomId}`);
        
        room.disconnectPeer(socket.id);
        
        this.io.to(roomId).emit('peerLeft', { 
          peerId: socket.id 
        });
        
        if (room.isEmpty()) {
          console.log(`Room ${roomId} is empty, closing and removing it`);
          room.close();
          this.rooms.delete(roomId);
        }
      }
      
      this.userRooms.delete(socket.id);
    }
  }

  async handleKickPeer(
    socket: Socket,
    { peerId, roomId }: { peerId: string; roomId: string }
  ) {
    try {
      const room = this.rooms.get(roomId);
      if (!room) {
        console.log(`Room ${roomId} not found`);
        return;
      }

      await this.disconnectPeerFromRoom(peerId, roomId);
      
      const peerSocket = this.io.sockets.sockets.get(peerId);
      if (peerSocket) {
        peerSocket.disconnect(true);
      }
    } catch (error) {
      console.error('Error kicking peer:', error);
    }
  }

  handleRequestSync(
    socket: Socket,
    { peerId }: { peerId: string }
  ) {
    try {
      const roomId = Array.from(socket.rooms).find(room => room !== socket.id);
      if (!roomId) return;

      const targetSocket = this.io.sockets.sockets.get(peerId);
      if (targetSocket && targetSocket.rooms.has(roomId)) {
        console.log(`Requesting sync from peer ${peerId} for ${socket.id}`);
        targetSocket.emit('requestSync');
      } else {
        console.log(`Target peer ${peerId} not found or not in same room`);
      }
    } catch (error) {
      console.error('Error processing sync request:', error);
    }
  }

  private async disconnectPeerFromRoom(socketId: string, roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    console.log(`Forcefully disconnecting peer ${socketId} from room ${roomId}`);
    
    room.disconnectPeer(socketId);
    
    this.io.to(roomId).emit('peerLeft', { peerId: socketId });
    
    if (room.isEmpty()) {
      console.log(`Room ${roomId} is empty, closing and removing it`);
      room.close();
      this.rooms.delete(roomId);
    }
  }
}
