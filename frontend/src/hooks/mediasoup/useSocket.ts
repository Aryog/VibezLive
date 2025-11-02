import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = 'http://localhost:3000';

interface UseSocketResult {
  socket: Socket | null;
  isConnected: boolean;
}

export const useSocket = (roomId: string): UseSocketResult => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Only create socket connection if roomId exists
    if (!roomId) {
      return;
    }

    const socketInstance = io(SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 5,
      transports: ['websocket'],
    });

    socketInstance.on('connect', () => {
      console.log('Connected to server with ID:', socketInstance.id);
      setIsConnected(true);
      // Join room immediately after connection
      socketInstance.emit('joinRoom', { roomId });
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
      setSocket(null);
      setIsConnected(false);
    };
  }, [roomId]);

  return { socket, isConnected };
};
