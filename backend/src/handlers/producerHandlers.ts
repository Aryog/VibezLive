import { Socket } from 'socket.io';
import { Room } from '../room.js';

export class ProducerHandlers {
  async handleProduce(
    socket: Socket,
    { kind, rtpParameters, appData }: { kind: string; rtpParameters: any; appData?: any },
    callback: Function,
    room: Room,
    roomId: string
  ) {
    try {
      const producerId = await room.produce(socket.id, kind, rtpParameters, appData);

      socket.to(roomId).emit('newProducer', { 
        producerId,
        peerId: socket.id,
        kind,
        appData
      });

      callback({ producerId });
    } catch (error) {
      console.error('Error producing:', error);
      callback({ error: error instanceof Error ? error.message : 'Unknown producer error' });
    }
  }

  async handleCloseProducer(
    socket: Socket,
    { producerId }: { producerId: string },
    room: Room,
    roomId: string
  ) {
    try {
      // Get all consumers for this producer before closing it
      const consumers = room.getConsumersForProducer(producerId);
      
      const closed = await room.closeSpecificProducer(producerId);
      
      if (closed) {
        // Notify each consumer individually with their consumer ID
        consumers.forEach(({ socketId, consumerId }) => {
          socket.to(socketId).emit('producerClosed', { 
            producerId, 
            consumerId 
          });
        });
        
        console.log(`Producer ${producerId} closed by socket ${socket.id}, notified ${consumers.length} consumers`);
      }
    } catch (error) {
      console.error('Error closing producer:', error);
    }
  }
}
