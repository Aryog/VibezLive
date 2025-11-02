import React, { useState } from 'react';
import { Video, Users, Copy, Check } from 'lucide-react';

interface PreMeetingProps {
  roomId: string;
  setRoomId: (id: string) => void;
  handleJoinRoom: () => void;
}

export const PreMeeting: React.FC<PreMeetingProps> = ({ roomId, setRoomId, handleJoinRoom }) => {
  const [mode, setMode] = useState<'home' | 'join'>('home');
  const [copied, setCopied] = useState(false);

  // Generate a random room ID
  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 10);
  };

  // Create instant meeting
  const handleCreateInstantMeeting = () => {
    const newRoomId = generateRoomId();
    setRoomId(newRoomId);
    handleJoinRoom();
  };

  // Copy room link to clipboard
  const copyRoomLink = () => {
    const roomLink = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900">
      <div className="bg-gray-800/90 backdrop-blur-sm p-8 rounded-2xl shadow-2xl w-[480px] max-w-full border border-gray-700">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-3">
            <Video className="w-10 h-10 text-blue-500 mr-2" />
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              VibezLive
            </h1>
          </div>
          <p className="text-gray-400 text-sm">Premium video conferencing for everyone</p>
        </div>

        {mode === 'home' ? (
          <div className="space-y-4">
            {/* Create Instant Meeting */}
            <button
              onClick={handleCreateInstantMeeting}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 px-6 py-4 rounded-xl font-semibold transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
            >
              <Video className="w-5 h-5" />
              Create Instant Meeting
            </button>

            {/* Divider */}
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-gray-800 text-gray-400">or</span>
              </div>
            </div>

            {/* Join Meeting */}
            <button
              onClick={() => setMode('join')}
              className="w-full bg-gray-700 hover:bg-gray-600 px-6 py-4 rounded-xl font-semibold transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 border border-gray-600"
            >
              <Users className="w-5 h-5" />
              Join a Meeting
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Back Button */}
            <button
              onClick={() => setMode('home')}
              className="text-gray-400 hover:text-white text-sm mb-2 flex items-center gap-1"
            >
              ← Back
            </button>

            {/* Join Meeting Form */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Meeting Code or Link
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter meeting code (e.g., abc123)"
                className="w-full px-4 py-3 bg-gray-700 rounded-lg text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && roomId.trim()) {
                    handleJoinRoom();
                  }
                }}
              />
            </div>

            <button
              onClick={handleJoinRoom}
              disabled={!roomId.trim()}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed px-6 py-4 rounded-xl font-semibold transition-all transform hover:scale-[1.02] active:scale-[0.98] disabled:transform-none shadow-lg"
            >
              Join Meeting
            </button>

            {/* Quick Copy Link (if roomId exists) */}
            {roomId && (
              <div className="mt-4 p-3 bg-gray-700/50 rounded-lg border border-gray-600">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-2">
                    <p className="text-xs text-gray-400 mb-1">Meeting Link</p>
                    <p className="text-sm text-gray-300 truncate">
                      {window.location.origin}?room={roomId}
                    </p>
                  </div>
                  <button
                    onClick={copyRoomLink}
                    className="p-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-700 text-center">
          <p className="text-xs text-gray-500">
            Secure, encrypted video conferencing
          </p>
        </div>
      </div>
    </div>
  );
}; 