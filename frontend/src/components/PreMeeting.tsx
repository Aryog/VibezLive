import React from 'react';

interface PreMeetingProps {
  roomId: string;
  setRoomId: (id: string) => void;
  handleJoinRoom: () => void;
}

export const PreMeeting: React.FC<PreMeetingProps> = ({ roomId, setRoomId, handleJoinRoom }) => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-96 max-w-full">
        <h1 className="text-2xl font-bold mb-6 text-center">VibezLive</h1>
        <div className="mb-6">
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter code or link"
            className="w-full px-4 py-3 bg-gray-700 rounded mb-4 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleJoinRoom}
            className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-3 rounded font-medium transition"
          >
            Join now
          </button>
        </div>
      </div>
    </div>
  );
}; 