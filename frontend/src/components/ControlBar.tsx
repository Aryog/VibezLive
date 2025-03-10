import React from 'react';
import { Video, Mic, MicOff, VideoOff, Share, PhoneOff, Settings, MoreVertical, Users } from 'lucide-react';
import { cn } from '../lib/utils';

interface ControlBarProps {
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  showMenu: boolean;
  roomId: string;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => void;
  setShowMenu: (show: boolean) => void;
  leaveMeeting: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isMuted,
  isVideoOff,
  isScreenSharing,
  showMenu,
  roomId,
  toggleMute,
  toggleVideo,
  toggleScreenShare,
  setShowMenu,
  leaveMeeting
}) => {
  return (
    <div className="h-[10vh] bg-gray-900 flex items-center justify-between px-6">
      <div className="text-sm text-gray-300">
        {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
      </div>
      
      <div className="flex items-center gap-4">
        <button
          onClick={toggleMute}
          className={cn(
            "p-3 rounded-full transition",
            isMuted ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"
          )}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>
        
        <button
          onClick={toggleVideo}
          className={cn(
            "p-3 rounded-full transition",
            isVideoOff ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"
          )}
        >
          {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
        </button>
        
        <button
          onClick={toggleScreenShare}
          className={cn(
            "p-3 rounded-full transition",
            isScreenSharing ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"
          )}
        >
          <Share size={20} />
        </button>
        
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 transition relative"
        >
          <MoreVertical size={20} />
          
          {showMenu && (
            <div className="absolute bottom-full right-0 mb-2 bg-gray-800 rounded-lg shadow-lg p-2 w-48">
              <button className="w-full text-left px-3 py-2 hover:bg-gray-700 rounded flex items-center">
                <Settings size={16} className="mr-2" /> Settings
              </button>
              <button className="w-full text-left px-3 py-2 hover:bg-gray-700 rounded flex items-center">
                <Users size={16} className="mr-2" /> Participants
              </button>
            </div>
          )}
        </button>
        
        <button
          onClick={leaveMeeting}
          className="p-3 rounded-full bg-red-600 hover:bg-red-700 transition"
        >
          <PhoneOff size={20} />
        </button>
      </div>
      
      <div className="text-sm">
        {roomId}
      </div>
    </div>
  );
}; 