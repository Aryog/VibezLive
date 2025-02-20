import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import MediasoupService from '../services/MediasoupService';
import type { Consumer } from 'mediasoup-client/lib/types';
import WebSocketService from '../services/WebSocketService';

export default function Room() {
  const { roomId } = useParams();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isPublishing, setIsPublishing] = useState(false);
  const [notifications, setNotifications] = useState<Array<{
    type: 'join' | 'leave';
    username: string;
    timestamp: string;
  }>>([]);

  useEffect(() => {
    const joinRoom = async () => {
      if (!roomId) return;
      
      const peerId = `peer-${Math.random().toString(36).substr(2, 9)}`;
      await MediasoupService.join(roomId, peerId);
      await MediasoupService.createSendTransport();

      MediasoupService.setOnNewConsumer((consumer: Consumer) => {
        const stream = new MediaStream([consumer.track]);
        setRemoteStreams(prev => new Map(prev).set(consumer.id, stream));
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

    return () => {
      WebSocketService.off('userJoined');
      WebSocketService.off('userLeft');
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
    } catch (error) {
      console.error('Error starting stream:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold mb-4">Room: {roomId}</h1>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Local Video */}
            <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams).map(([consumerId, stream]) => (
              <div key={consumerId} className="aspect-video bg-gray-900 rounded-lg overflow-hidden">
                <video
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                  ref={el => {
                    if (el) el.srcObject = stream;
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex justify-center">
            {!isPublishing ? (
              <button
                onClick={startStreaming}
                className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
              >
                Start Streaming
              </button>
            ) : (
              <button
                className="bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition-colors"
              >
                Stop Streaming
              </button>
            )}
          </div>
        </div>

        {/* Notifications */}
        <div className="fixed bottom-4 right-4 space-y-2">
          {notifications.slice(-3).map((notification, index) => (
            <div 
              key={index}
              className={`p-3 rounded-lg text-white ${
                notification.type === 'join' ? 'bg-green-500' : 'bg-red-500'
              }`}
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