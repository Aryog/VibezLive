import { Socket } from 'socket.io';
import { Room } from '../room.js';

export class RoomHandlers {
  constructor(
    private rooms: Map<string, Room>,
    private userRooms: Map<string, string>
  ) {}

  async handleJoinRoom(
    socket: Socket,
    { roomId }: { roomId: string },
    worker: any
  ) {
    try {
      if (!this.rooms.has(roomId)) {
        const room = new Room(roomId, worker);
        this.rooms.set(roomId, room);
      }

      const room = this.rooms.get(roomId)!;
      socket.join(roomId);
      
      this.userRooms.set(socket.id, roomId);

      const routerRtpCapabilities = await room.getRtpCapabilities();
      socket.emit('routerCapabilities', { routerRtpCapabilities });

      const producers = room.getProducersInfo();
      socket.emit('currentProducers', { producers });

      socket.to(roomId).emit('newPeer', { peerId: socket.id });
    } catch (error) {
      console.error('Error joining room:', error);
    }
  }

  getRoomId(socket: Socket): string | undefined {
    return Array.from(socket.rooms).find(room => room !== socket.id);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }
}
