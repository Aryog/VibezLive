import { Socket } from 'socket.io';
import { Room } from '../room.js';

export class ConsumerHandlers {
  async handleConsume(
    socket: Socket,
    { producerId, rtpCapabilities }: { producerId: string; rtpCapabilities: any },
    callback: Function,
    room: Room
  ) {
    try {
      const params = await room.consume(socket.id, producerId, rtpCapabilities);
      callback({ params });
    } catch (error) {
      console.error('Error consuming:', error);
      callback({ error: error instanceof Error ? error.message : 'Unknown consumer error' });
    }
  }

  async handleResumeConsumer(
    socket: Socket,
    { consumerId }: { consumerId: string },
    room: Room
  ) {
    try {
      await room.resumeConsumer(socket.id, consumerId);
    } catch (error) {
      console.error('Error resuming consumer:', error);
    }
  }
}
