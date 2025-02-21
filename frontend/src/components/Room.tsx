import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import MediasoupService from '../services/MediasoupService';
import type { Consumer } from 'mediasoup-client/lib/types';
import WebSocketService from '../services/WebSocketService';

interface RemoteStream {
  stream: MediaStream;
  username: string;
  peerId: string;
  isActive: boolean;
}

interface JoinResponse {
  roomId: string;
  peerId: string;
  routerRtpCapabilities: any;
  existingProducers: {
    producerId: string;
    username: string;
    kind: string;
  }[];
}

export default function Room() {
  const { roomId } = useParams();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map());
  const [isPublishing, setIsPublishing] = useState(false);
  const [username, setUsername] = useState('');
  const [notifications, setNotifications] = useState<Array<{
    type: 'join' | 'leave';
    username: string;
    timestamp: string;
  }>>([]);
  const [peers, setPeers] = useState<Map<string, { username: string; isStreaming: boolean }>>(new Map());

  useEffect(() => {
    // Prompt for username when joining
    const userInput = prompt('Enter your username:');
    if (userInput) {
      setUsername(userInput);
    }

    const joinRoom = async () => {
      if (!roomId || !userInput) return;
      
      const peerId = `peer-${Math.random().toString(36).substr(2, 9)}`;
      const joinResponse = await MediasoupService.join(roomId, peerId, userInput) as JoinResponse;

      // Set up consumer handler for new streams
      MediasoupService.setOnNewConsumer((consumer: Consumer, producerUsername: string) => {
        const stream = new MediaStream([consumer.track]);
        setRemoteStreams(prev => new Map(prev).set(consumer.id, {
          stream,
          username: producerUsername,
          peerId: consumer.producerId,
          isActive: true
        }));
      });
    };

    joinRoom();

    WebSocketService.on('userJoined', (data) => {
      setNotifications(prev => [...prev, {
        type: 'join',
        username: data.username,
        timestamp: data.timestamp
      }]);
    });

    WebSocketService.on('userLeft', (data) => {
      setNotifications(prev => [...prev, {
        type: 'leave',
        username: data.username,
        timestamp: data.timestamp
      }]);
    });

    WebSocketService.on('newProducer', async (data) => {
      try {
        console.log('New producer notification received:', data);
        setPeers(prev => new Map(prev).set(data.peerId, { 
          username: data.username, 
          isStreaming: true 
        }));
        await MediasoupService.consumeStream(data.producerId, data.username);
      } catch (error) {
        console.error('Error consuming new producer:', error);
      }
    });

    WebSocketService.on('peerStreamingStatusChanged', (data) => {
      setPeers(prev => {
        const newPeers = new Map(prev);
        newPeers.set(data.peerId, {
          username: data.username,
          isStreaming: data.isStreaming
        });
        return newPeers;
      });
    });

    return () => {
      WebSocketService.off('userJoined');
      WebSocketService.off('userLeft');
      WebSocketService.off('newProducer');
      WebSocketService.off('peerStreamingStatusChanged');
    };
  }, [roomId]);

  // Add cleanup for remote streams when user leaves
  useEffect(() => {
    const handleUserLeft = (data: { username: string }) => {
      setRemoteStreams(prev => {
        const newStreams = new Map(prev);
        for (const [id, stream] of newStreams) {
          if (stream.username === data.username) {
            newStreams.delete(id);
          }
        }
        return newStreams;
      });

      setPeers(prev => {
        const newPeers = new Map(prev);
        for (const [peerId, peer] of newPeers) {
          if (peer.username === data.username) {
            newPeers.delete(peerId);
          }
        }
        return newPeers;
      });
    };

    WebSocketService.on('userLeft', handleUserLeft);
    return () => {
      WebSocketService.off('userLeft', handleUserLeft);
    };
  }, []);

  const startStreaming = async () => {
    try {
      console.log('Starting stream...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Publish the entire stream
      await MediasoupService.publish(stream);
      setIsPublishing(true);
    } catch (error) {
      console.error('Error starting stream:', error);
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
                  onClick={() => setIsPublishing(false)}
                  className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
                >
                  Stop Streaming
                </button>
              )}
            </div>
          </div>
          
          {/* Video Grid */}
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
                      // Ensure video plays
                      el.play().catch(console.error);
                    }
                  }}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-2">
                  <span className="text-sm font-medium">{remoteStream.username}</span>
                  {remoteStream.isActive && (
                    <span className="ml-2 text-xs bg-green-500 px-2 py-1 rounded">Live</span>
                  )}
                </div>
              </div>
            ))}

            {/* Show placeholder for peers who haven't started streaming */}
            {Array.from(peers.entries())
              .filter(([peerId]) => !Array.from(remoteStreams.values()).some(s => s.peerId === peerId))
              .map(([peerId, peer]) => (
                <div 
                  key={peerId}
                  className="aspect-video bg-gray-800 rounded-lg overflow-hidden relative flex items-center justify-center"
                >
                  <div className="text-white text-center">
                    <p className="text-lg font-medium">{peer.username}</p>
                    <p className="text-sm text-gray-400">Not streaming</p>
                  </div>
                </div>
              ))}
          </div>

          {/* Active Users List */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h2 className="text-lg font-semibold mb-3">Active Users</h2>
            <div className="flex flex-wrap gap-2">
              {Array.from(peers.entries()).map(([peerId, peer]) => (
                <div
                  key={peerId}
                  className={`px-3 py-1 rounded-full text-sm ${
                    peer.isStreaming ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {peer.username}
                  {peer.isStreaming && (
                    <span className="ml-2 text-xs">🎥</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="fixed bottom-4 right-4 space-y-2 z-50">
          {notifications.slice(-3).map((notification, index) => (
            <div 
              key={index}
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