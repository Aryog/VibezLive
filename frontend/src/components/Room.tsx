import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import MediasoupService from '../services/MediasoupService';
import WebSocketService from '../services/WebSocketService';
import type { Consumer } from 'mediasoup-client/lib/types';
import { JoinResponse } from '../types/joinResponse';
import RemoteVideo from './RemoteVideo';

interface RemoteStream {
  stream: MediaStream;
  username: string;
  peerId: string;
  isActive: boolean;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
}

interface User {
  id: string;
  username: string;
  isStreaming: boolean;
}

interface Notification {
  id: string;
  type: 'join' | 'leave';
  username: string;
  timestamp: number;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map());
  const [isPublishing, setIsPublishing] = useState(false);
  const [username, setUsername] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeUsers, setActiveUsers] = useState<User[]>([]);
  const currentPeerIdRef = useRef<string>('');
  const consumersRef = useRef<Map<string, Consumer>>(new Map());

  const addNotification = (type: 'join' | 'leave', username: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => [...prev, {
      id,
      type,
      username,
      timestamp: Date.now()
    }]);

    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const handleNewConsumer = async (consumer: Consumer, producerUsername: string) => {
    if (!consumer.track) {
      console.warn('Consumer has no track:', consumer);
      return;
    }

    try {
      console.log('New consumer received:', {
        id: consumer.id,
        kind: consumer.kind,
        producerId: consumer.producerId,
        username: producerUsername,
        trackEnabled: consumer.track.enabled,
        trackReadyState: consumer.track.readyState
      });

      // Enable the track explicitly
      consumer.track.enabled = true;
      
      await consumer.resume();
      consumersRef.current.set(consumer.id, consumer);

      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        // Look for an existing stream from the same producer
        const existingStream = Array.from(prev.values()).find(
          stream => stream.username === producerUsername && stream.peerId === consumer.producerId
        );

        if (existingStream) {
          // Update existing stream with new track
          const updatedStream = new MediaStream();
          
          // Add existing tracks that are not of the same kind as the new track
          existingStream.stream.getTracks().forEach(track => {
            if (track.kind !== consumer.track!.kind) {
              updatedStream.addTrack(track);
            }
          });
          
          // Add the new track
          updatedStream.addTrack(consumer.track);

          // Update the stream in the map
          newStreams.set(consumer.producerId, {
            ...existingStream,
            stream: updatedStream,
            [consumer.track.kind === 'video' ? 'videoTrack' : 'audioTrack']: consumer.track
          });
        } else {
          // Create new stream
          const newStream = new MediaStream([consumer.track]);
          
          newStreams.set(consumer.producerId, {
            stream: newStream,
            username: producerUsername,
            peerId: consumer.producerId,
            isActive: true,
            [consumer.track.kind === 'video' ? 'videoTrack' : 'audioTrack']: consumer.track
          });
        }

        return newStreams;
      });

    } catch (error) {
      console.error('Failed to handle new consumer:', error);
    }
  };

  useEffect(() => {
    const initializeRoom = async () => {
      const userInput = prompt('Enter your username:');
      if (!userInput || !roomId) return;
      
      setUsername(userInput);
      const peerId = `peer-${Math.random().toString(36).substr(2, 9)}`;
      currentPeerIdRef.current = peerId;

      try {
        const joinResponse: JoinResponse = await MediasoupService.join(roomId, peerId, userInput);
        MediasoupService.setOnNewConsumer(handleNewConsumer);

        setActiveUsers([{ id: peerId, username: userInput, isStreaming: false }]);

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

    const wsHandlers = {
      userJoined: (data: { username: string; peerId: string }) => {
        addNotification('join', data.username);
        setActiveUsers(prev => [...prev, { id: data.peerId, username: data.username, isStreaming: false }]);
      },

      userLeft: (data: { username: string; peerId: string }) => {
        addNotification('leave', data.username);
        setActiveUsers(prev => prev.filter(user => user.id !== data.peerId));
        
        setRemoteStreams(prev => {
          const newStreams = new Map(prev);
          for (const [id, stream] of newStreams) {
            if (stream.peerId === data.peerId) {
              stream.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
              newStreams.delete(id);
            }
          }
          return newStreams;
        });

        // Clean up consumers
        for (const [consumerId, consumer] of consumersRef.current) {
          if (consumer.producerId === data.peerId) {
            consumer.close();
            consumersRef.current.delete(consumerId);
          }
        }
      },

      newProducer: async (data: { producerId: string; username: string; peerId: string }) => {
        try {
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

    Object.entries(wsHandlers).forEach(([event, handler]) => {
      WebSocketService.on(event, handler);
    });

    return () => {
      Object.keys(wsHandlers).forEach(event => {
        WebSocketService.off(event);
      });
      
      if (localVideoRef.current?.srcObject) {
        const stream = localVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }

      // Close all consumers
      consumersRef.current.forEach(consumer => consumer.close());
      consumersRef.current.clear();

      // Clear all remote streams
      setRemoteStreams(prev => {
        prev.forEach(stream => {
          stream.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        });
        return new Map();
      });
      
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

      // Ensure tracks are enabled
      stream.getTracks().forEach(track => {
        track.enabled = true;
        console.log(`Local track enabled:`, {
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted
        });
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      await MediasoupService.publish(stream);
      setIsPublishing(true);
      
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

      setActiveUsers(prev => 
        prev.map(user => 
          user.id === currentPeerIdRef.current ? { ...user, isStreaming: false } : user
        )
      );
    } catch (error) {
      console.error('Failed to stop streaming:', error);
    }
  };

  const logStreamState = () => {
    console.log('Current State:', {
      remoteStreams: Array.from(remoteStreams.entries()).map(([id, stream]) => ({
        id,
        username: stream.username,
        hasVideo: !!stream.videoTrack,
        hasAudio: !!stream.audioTrack,
        videoEnabled: stream.videoTrack?.enabled,
        audioEnabled: stream.audioTrack?.enabled,
        videoReadyState: stream.videoTrack?.readyState,
        audioReadyState: stream.audioTrack?.readyState
      })),
      activeUsers,
      consumers: Array.from(consumersRef.current.entries()).map(([id, consumer]) => ({
        id,
        kind: consumer.kind,
        closed: consumer.closed,
        paused: consumer.paused,
        producerId: consumer.producerId
      }))
    });
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
              <button
                onClick={logStreamState}
                className="bg-gray-500 text-white px-4 py-2 rounded"
              >
                Debug State
              </button>
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
              <RemoteVideo 
                key={remoteStream.peerId} 
                remoteStream={remoteStream}
              />
            ))}

            {/* Placeholders */}
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

          {/* Active Users */}
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