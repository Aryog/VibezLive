import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { env } from '../../config/env';

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

    console.log(`Connecting to server at ${env.serverUrl}`);
    
    const socketInstance = io(env.serverUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      transports: ['websocket'],
      withCredentials: true,
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
