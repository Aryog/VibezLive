import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Room {
  roomId: string;
  activeUsers: {
    username: string;
    hasStream: boolean;
  }[];
}

interface User {
  username: string;
  hasStream?: boolean; // Optional if it may not always be present
}

const RoomList = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [newRoomId, setNewRoomId] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchRooms();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchRooms = async () => {
    try {
      // Get list of rooms
      const roomsResponse = await fetch('http://localhost:5000/api/rooms/list');
      const roomsData = await roomsResponse.json();

      // Get active users for each room
      const roomsWithUsers = await Promise.all(
        roomsData.rooms.map(async (roomId: string) => {
          const usersResponse = await fetch(`http://localhost:5000/api/active-users/${roomId}`);
          const usersData = await usersResponse.json();
          return {
            roomId,
            activeUsers: usersData.users.map((user: User) => ({
              ...user,
              hasStream: user.hasStream || false // Ensure hasStream is set
            }))
          };
        })
      );

      setRooms(roomsWithUsers);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newRoomId) {
      try {
        const response = await fetch('http://localhost:5000/api/rooms/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: newRoomId }),
        });
        
        if (response.ok) {
          navigate(`/room/${newRoomId}`);
        }
      } catch (error) {
        console.error('Error creating room:', error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">VibezLive</h1>
        
        {/* Create Room Form */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-xl font-semibold mb-4">Create New Room</h2>
          <form onSubmit={handleCreateRoom} className="flex gap-4">
            <input
              type="text"
              value={newRoomId}
              onChange={(e) => setNewRoomId(e.target.value)}
              placeholder="Enter Room ID"
              className="flex-1 px-4 py-2 border rounded-lg"
              required
            />
            <button
              type="submit"
              className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
            >
              Create Room
            </button>
          </form>
        </div>

        {/* Available Rooms */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rooms.map((room) => (
            <div key={room.roomId} className="bg-white p-6 rounded-lg shadow-md">
              <h3 className="text-lg font-semibold mb-4">Room: {room.roomId}</h3>
              
              <div className="mb-4">
                <h4 className="font-medium mb-2">Active Users:</h4>
                <ul className="space-y-2">
                  {room.activeUsers.map((user) => (
                    <li 
                      key={user.username}
                      className="flex items-center gap-2"
                    >
                      <span className={`w-2 h-2 rounded-full ${user.hasStream ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {user.username}
                      {user.hasStream && <span className="text-xs text-green-500">(Streaming)</span>}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => navigate(`/room/${room.roomId}`)}
                className="w-full bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
              >
                Join Room
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RoomList; 