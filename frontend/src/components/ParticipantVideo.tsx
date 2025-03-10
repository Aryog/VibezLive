import React from 'react';
import { Mic, MicOff, VideoOff, Pin } from 'lucide-react';
import { cn } from '../lib/utils';
import { Participant } from '../types';

interface ParticipantVideoProps {
  participant: Participant;
  isLocal: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
  onTogglePin?: (id: string) => void;
  streamRef?: React.MutableRefObject<MediaStream | null>;
  setPeerVideoRef?: (id: string, el: HTMLVideoElement | null) => void;
}

export const ParticipantVideo: React.FC<ParticipantVideoProps> = ({
  participant,
  isLocal,
  isMuted,
  isVideoOff,
  onTogglePin,
  streamRef,
  setPeerVideoRef
}) => {
  return (
    <div 
      className={cn(
        "relative rounded-lg overflow-hidden border-2",
        participant.isSpeaking ? "border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.5)]" : "border-gray-700"
      )}
    >
      {isLocal ? (
        <video
          ref={(el) => {
            if (el && (!el.srcObject || el.srcObject !== streamRef?.current) && streamRef?.current && !isVideoOff) {
              try {
                el.srcObject = streamRef.current;
                el.muted = true;
              } catch (error) {
                console.error('Error setting local video source:', error);
              }
            }
          }}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover bg-black"
        />
      ) : (
        <video
          ref={el => {
            if (el && (!el.srcObject || el.srcObject !== participant.videoStream) && participant.videoStream) {
              el.srcObject = participant.videoStream;
              setPeerVideoRef?.(participant.id, el);
            }
          }}
          autoPlay
          playsInline
          className="w-full h-full object-cover bg-black"
        />
      )}
      
      {/* Speaking indicator */}
      {participant.isSpeaking && (
        <div className="absolute top-2 right-2 bg-green-400 rounded-full p-1.5 shadow-[0_0_10px_rgba(74,222,128,0.7)] backdrop-blur-sm">
          <Mic size={14} className="text-black" />
        </div>
      )}
      
      {/* Controls overlay */}
      <div className="absolute inset-0 flex flex-col justify-between p-2">
        <div className="flex justify-between items-start">
          <div className="flex gap-1">
            {isLocal && isMuted && (
              <div className="p-1.5 bg-red-600 rounded-md">
                <MicOff size={16} />
              </div>
            )}
            {((isLocal && isVideoOff) || (!participant.hasVideo && !isLocal)) && (
              <div className="p-1.5 bg-red-600 rounded-md">
                <VideoOff size={16} />
              </div>
            )}
          </div>
          
          {!isLocal && onTogglePin && (
            <button 
              onClick={() => onTogglePin(participant.id)} 
              className="p-1.5 bg-black bg-opacity-60 rounded-md hover:bg-opacity-80"
            >
              <Pin size={16} />
            </button>
          )}
        </div>
        
        {/* Name tag and speaking indicator */}
        <div className="flex items-center justify-between w-full px-2 py-1.5 bg-black bg-opacity-60 rounded-md">
          <span className="text-sm font-medium truncate">
            {participant.name}
          </span>
          {participant.isSpeaking && (
            <div className="flex items-center gap-1 bg-green-400/20 px-2 py-0.5 rounded-full">
              <Mic size={12} className="text-green-400" />
              <span className="text-xs text-green-400">Speaking</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Video off avatar */}
      {((isLocal && isVideoOff) || (!participant.hasVideo && !isLocal)) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="rounded-full bg-gray-700 w-20 h-20 flex items-center justify-center text-2xl font-medium">
            {participant.name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}
    </div>
  );
}; 