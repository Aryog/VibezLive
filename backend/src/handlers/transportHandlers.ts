import { Socket } from 'socket.io';
import { Room } from '../room.js';

export class TransportHandlers {
  async handleCreateWebRtcTransport(
    socket: Socket,
    { sender }: { sender: boolean },
    callback: Function,
    room: Room
  ) {
    try {
      const transport = await room.createWebRtcTransport(socket.id, sender);
      callback({ params: transport });
    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      callback({ error: error instanceof Error ? error.message : 'Unknown transport error' });
    }
  }

  async handleConnectTransport(
    socket: Socket,
    { dtlsParameters, sender }: { dtlsParameters: any; sender: boolean },
    room: Room
  ) {
    try {
      await room.connectTransport(socket.id, dtlsParameters, sender);
    } catch (error) {
      console.error('Error connecting transport:', error);
    }
  }
}
