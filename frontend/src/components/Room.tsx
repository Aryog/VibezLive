import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import MediasoupService from '../services/MediasoupService';
import WebSocketService from '../services/WebSocketService';
import type { Consumer } from 'mediasoup-client/lib/types';
import { JoinResponse } from '../types/joinResponse';

interface RemoteStream {
  stream: MediaStream;
  username: string;
  peerId: string;
  isActive: boolean;
}

interface User {
  id: string;
  username: string;
  isStreaming: boolean;
}

export default function Room() {
  const { roomId } = useParams();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map());
  const [isPublishing, setIsPublishing] = useState(false);
  const [username, setUsername] = useState('');
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: 'join' | 'leave';
    username: string;
    timestamp: number;
  }>>([]);
  const [activeUsers, setActiveUsers] = useState<User[]>([]);
  const currentPeerIdRef = useRef<string>('');

  const addNotification = (type: 'join' | 'leave', username: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, {
      id,
      type,
      username,
      timestamp: Date.now()
    }]);

    // Remove notification after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  useEffect(() => {
    const initializeRoom = async () => {
      const userInput = prompt('Enter your username:');
      if (!userInput || !roomId) return;
      
      setUsername(userInput);
      const peerId = `peer-${Math.random().toString(36).substr(2, 9)}`;
      currentPeerIdRef.current = peerId;

      try {
        // Specify the type for joinResponse
        const joinResponse: JoinResponse = await MediasoupService.join(roomId, peerId, userInput);
        console.log('Successfully joined room:', joinResponse);

        // Set up consumer handler
        MediasoupService.setOnNewConsumer(async (consumer: Consumer, producerUsername: string) => {
          console.log('New consumer added:', { consumerId: consumer.id, producerUsername });
          const stream = new MediaStream([consumer.track]);
          
          setRemoteStreams(prev => {
            const newStreams = new Map(prev);
            newStreams.set(consumer.id, {
              stream,
              username: producerUsername,
              peerId: consumer.producerId,
              isActive: true
            });
            return newStreams;
          });
        });

        // Consume existing streams
        if (joinResponse.existingProducers) {
          for (const producer of joinResponse.existingProducers) {
            await MediasoupService.consumeStream(producer.producerId, producer.username);
          }
        }
      } catch (error) {
        console.error('Failed to initialize room:', error);
        alert('Failed to join room. Please try again.');
      }
    };

    initializeRoom();

    // Set up WebSocket listeners
    const wsHandlers = {
      userJoined: (data: { username: string; peerId: string }) => {
        addNotification('join', data.username);
        setActiveUsers(prev => [...prev, { id: data.peerId, username: data.username, isStreaming: false }]);
      },

      userLeft: (data: { username: string; peerId: string }) => {
        addNotification('leave', data.username);
        setActiveUsers(prev => prev.filter(user => user.id !== data.peerId));
        
        // Clean up remote streams for the user who left
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          for (const [id, stream] of newStreams) {
            if (stream.peerId === data.peerId) {
              newStreams.delete(id);
            }
          }
          return newStreams;
        });
      },

      newProducer: async (data: { producerId: string; username: string; peerId: string }) => {
        try {
          console.log('New producer available:', data);
          await MediasoupService.consumeStream(data.producerId, data.username);
          setActiveUsers(prev => 
            prev.map(user => 
              user.id === data.peerId ? { ...user, isStreaming: true } : user
            )
          );
        } catch (error) {
          console.error('Failed to consume new producer:', error);
        }
      },

      activeUsersUpdate: (users: User[]) => {
        setActiveUsers(users);
      }
    };

    // Register all WebSocket listeners
    Object.entries(wsHandlers).forEach(([event, handler]) => {
      WebSocketService.on(event, handler);
    });

    // Cleanup function
    return () => {
      Object.keys(wsHandlers).forEach(event => {
        WebSocketService.off(event);
      });
      
      // Clean up local stream
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      
      // Notify server about leaving
      if (currentPeerIdRef.current) {
        WebSocketService.emit('leaveRoom', {
          peerId: currentPeerIdRef.current,
          roomId
        });
      }
    };
  }, [roomId]);

  const startStreaming = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      await MediasoupService.publish(stream);
      setIsPublishing(true);
      
      // Update local user streaming status
      setActiveUsers(prev => 
        prev.map(user => 
          user.id === currentPeerIdRef.current ? { ...user, isStreaming: true } : user
        )
      );
    } catch (error) {
      console.error('Failed to start streaming:', error);
      alert('Failed to start streaming. Please check your camera and microphone permissions.');
    }
  };

  const stopStreaming = async () => {
    try {
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        localVideoRef.current.srcObject = null;
      }

      await MediasoupService.closeProducers();
      setIsPublishing(false);

      // Update local user streaming status
      setActiveUsers(prev => 
        prev.map(user => 
          user.id === currentPeerIdRef.current ? { ...user, isStreaming: false } : user
        )
      );
    } catch (error) {
      console.error('Failed to stop streaming:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">Room: {roomId}</h1>
            <div className="flex gap-4">
              {!isPublishing ? (
                <button
                  onClick={startStreaming}
                  className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Start Streaming
                </button>
              ) : (
                <button
                  onClick={stopStreaming}
                  className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
                >
                  Stop Streaming
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Local Video */}
            <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-2">
                <span className="text-sm font-medium">You ({username})</span>
                {isPublishing && (
                  <span className="ml-2 text-xs bg-green-500 px-2 py-1 rounded">Live</span>
                )}
              </div>
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams.values()).map((remoteStream) => (
              <div 
                key={remoteStream.peerId}
                className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative"
              >
                <video
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                  ref={el => {
                    if (el) {
                      el.srcObject = remoteStream.stream;
                      el.play().catch(console.error);
                    }
                  }}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-2">
                  <span className="text-sm font-medium">{remoteStream.username}</span>
                  <span className="ml-2 text-xs bg-green-500 px-2 py-1 rounded">Live</span>
                </div>
              </div>
            ))}

            {/* Placeholders for non-streaming users */}
            {activeUsers
              .filter(user => 
                user.id !== currentPeerIdRef.current && 
                !Array.from(remoteStreams.values()).some(s => s.peerId === user.id)
              )
              .map(user => (
                <div 
                  key={user.id}
                  className="aspect-video bg-gray-800 rounded-lg overflow-hidden relative flex items-center justify-center"
                >
                  <div className="text-white text-center">
                    <p className="text-lg font-medium">{user.username}</p>
                    <p className="text-sm text-gray-400">Not streaming</p>
                  </div>
                </div>
              ))}
          </div>

          {/* Active Users List */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h2 className="text-lg font-semibold mb-3">Active Users ({activeUsers.length})</h2>
            <div className="flex flex-wrap gap-2">
              {activeUsers.map(user => (
                <div
                  key={user.id}
                  className={`px-3 py-1 rounded-full text-sm ${
                    user.isStreaming ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {user.username}
                  {user.isStreaming && (
                    <span className="ml-2 text-xs">🎥</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="fixed bottom-4 right-4 space-y-2 z-50">
          {notifications.slice(-3).map((notification) => (
            <div 
              key={notification.id}
              className={`p-3 rounded-lg text-white ${
                notification.type === 'join' ? 'bg-green-500' : 'bg-red-500'
              } animate-fade-in`}
            >
              {notification.type === 'join' ? '👋 ' : '👋 '}
              {notification.username} has {notification.type === 'join' ? 'joined' : 'left'} the room
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}