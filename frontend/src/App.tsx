import { RouterProvider, createBrowserRouter, useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import MediasoupService from './services/MediasoupService';

interface User {
  id: string;
  username: string;
  isStreaming: boolean;
}

interface StreamInfo {
  peerId: string;
  stream: MediaStream;
  isLocal: boolean;
}

function VideoPlayer({ stream, isLocal }: { stream: MediaStream; isLocal: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Only stop tracks if they're being replaced with a new stream
    if (videoElement.srcObject && videoElement.srcObject !== stream) {
      videoElement.srcObject = null;
    }

    videoElement.srcObject = stream;

    const playVideo = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        await videoElement.play();
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            await videoElement.play();
          } catch (retryError) {
            console.error('Failed to play video after retry:', retryError);
          }
        } else {
          console.error('Error playing video:', error);
        }
      }
    };

    playVideo();

    return () => {
      if (videoElement.srcObject) {
        videoElement.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full object-cover rounded-lg ${isLocal ? 'mirror' : ''}`}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 text-white">
          No Stream Available
        </div>
      )}
    </div>
  );
}

// Room component
function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const connectionRef = useRef<{ peerId: string | null }>({ peerId: null });

  useEffect(() => {
    // Only create connection if we haven't already
    if (!connectionRef.current.peerId) {
      connectionRef.current.peerId = crypto.randomUUID();
    }
    
    const connectToRoom = async () => {
      try {
        if (!roomId) throw new Error('Room ID is required');
        
        await MediasoupService.connectToRoom(roomId, connectionRef.current.peerId!);
        
        MediasoupService.onUserUpdate((updatedUsers) => {
          setUsers(updatedUsers);
        });

        MediasoupService.onStream((streams) => {
          setStreams(streams);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to room');
        console.error('Room connection error:', err);
      }
    };

    connectToRoom();

    // Cleanup function
    return () => {
      MediasoupService.disconnect();
      // Don't clear the peerId on normal unmounts
      // connectionRef.current.peerId = null;
    };
  }, [roomId]);

  const toggleStreaming = async () => {
    try {
      if (isStreaming) {
        await MediasoupService.stopStreaming();
      } else {
        await MediasoupService.startStreaming();
      }
      setIsStreaming(!isStreaming);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Streaming error occurred');
      console.error('Streaming error:', err);
    }
  };

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p>{error}</p>
          <button 
            onClick={() => navigate('/')}
            className="mt-2 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Return to Rooms
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl">Room: {roomId}</h1>
        <div className="space-x-4">
          <button
            onClick={toggleStreaming}
            className={`px-4 py-2 rounded ${
              isStreaming 
                ? 'bg-red-500 hover:bg-red-600' 
                : 'bg-green-500 hover:bg-green-600'
            } text-white`}
          >
            {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
          </button>
          <Link
            to="/"
            className="inline-block px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Leave Room
          </Link>
        </div>
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {streams.map(({ peerId, stream, isLocal }) => (
          <div key={peerId} className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
            <VideoPlayer stream={stream} isLocal={isLocal} />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
              {isLocal ? 'You' : `Peer ${peerId}`}
            </div>
          </div>
        ))}
      </div>

      {/* User List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map(user => (
          <div 
            key={user.id}
            className={`p-4 rounded-lg shadow ${
              user.isStreaming ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
            } border`}
          >
            <h3 className="font-bold">{user.username}</h3>
            <p className="text-sm text-gray-600">
              {user.isStreaming ? '🎥 Streaming' : '⭕ Not Streaming'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// RoomList component
function RoomList() {
  const navigate = useNavigate();
  const [newRoomId, setNewRoomId] = useState('');

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRoomId.trim()) {
      navigate(`/room/${newRoomId}`);
    }
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Create or Join a Room</h1>

      <form onSubmit={handleCreateRoom} className="mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            value={newRoomId}
            onChange={(e) => setNewRoomId(e.target.value)}
            placeholder="Enter room ID"
            className="flex-1 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button
            type="submit"
            className="bg-blue-500 text-white px-6 py-2 rounded hover:bg-blue-600 transition-colors"
          >
            Join Room
          </button>
        </div>
      </form>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <RoomList />
  },
  {
    path: "/room/:roomId",
    element: <Room />
  }
]);

export default function App() {
  return <RouterProvider router={router} />;
}