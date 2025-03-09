import React, { useState, useEffect, useRef } from 'react';
import { Video, Mic, MicOff, VideoOff, Users, Monitor, PhoneOff, Settings, MoreVertical, Pin, PinOff, Share } from 'lucide-react';
import { cn } from './lib/utils';
import { useMediasoupStreaming } from './hooks/useMediasoupStreaming';

// Participant interface
interface Participant {
  id: string;
  videoRef: React.RefObject<HTMLVideoElement> | null;
  isLocal: boolean;
  hasVideo: boolean;
  videoStream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
}

function App() {
  const {
    roomId,
    setRoomId,
    isConnected,
    isMuted,
    isVideoOff,
    peers,
    localVideoLoading,
    isScreenSharing,
    localVideoRef,
    screenStreamRef,
    streamRef,
    handleJoinRoom,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    setPeerVideoRef,
    setPeerAudioRef,
  } = useMediasoupStreaming();

  // State
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const peerVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());

  // Auto-hide controls
  useEffect(() => {
    if (isConnected) {
      const handleMouseMove = () => {
        setShowControls(true);
        
        if (controlsTimerRef.current) {
          clearTimeout(controlsTimerRef.current);
        }
        
        controlsTimerRef.current = setTimeout(() => {
          setShowControls(false);
        }, 3000);
      };
      
      window.addEventListener('mousemove', handleMouseMove);
      handleMouseMove(); // Initialize timer
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      };
    }
  }, [isConnected]);

  // Pin/unpin participant
  const togglePin = (id: string | null) => {
    if (pinnedPeerId === id) {
      setPinnedPeerId(null);
    } else {
      setPinnedPeerId(id);
    }
  };

  // Get participants in the right order
  const getOrderedParticipants = (): Participant[] => {
    const participants: Participant[] = [
      { 
        id: 'local', 
        videoRef: localVideoRef as React.RefObject<HTMLVideoElement>,
        isLocal: true,
        hasVideo: !isVideoOff,
        videoStream: streamRef.current,
        screenStream: isScreenSharing ? screenStreamRef.current : null,
        name: 'You'
      }
    ];

    peers.forEach(peer => {
      participants.push({
        id: peer.id,
        videoRef: null,
        isLocal: false,
        hasVideo: !!peer.videoStream,
        videoStream: peer.videoStream || null,
        screenStream: peer.screenStream || null,
        name: `User ${peer.id.slice(0, 4)}`
      });
    });

    return participants;
  };

  // Leave meeting
  const leaveMeeting = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {!isConnected ? (
        // Pre-meeting screen
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
      ) : (
        // In-meeting screen
        <div className="h-screen flex flex-col">
          {/* Main video grid - 80% height */}
          <div className="flex-1 relative bg-black h-[80vh]">
            {/* Screen share takes precedence if present */}
            {getOrderedParticipants().some(p => p.screenStream) && (
              <div className="absolute inset-0 flex flex-row">
                {/* Screen share video - left side, 80% width */}
                <div className="w-[80%] h-full relative">
                  {getOrderedParticipants()
                    .filter(p => p.screenStream)
                    .map(participant => (
                      <div key={`screen-${participant.id}`} className="absolute inset-0">
                        <video
                          autoPlay
                          playsInline
                          className="w-full h-full object-contain bg-black"
                          ref={(el) => {
                            if (el && (participant.isLocal ? screenStreamRef.current : participant.screenStream)) {
                              el.srcObject = participant.isLocal ? screenStreamRef.current : participant.screenStream;
                            }
                          }}
                        />
                        
                        {/* Unpin button for screen share */}
                        <div className="absolute top-4 right-4">
                          <button 
                            onClick={() => togglePin(null)} 
                            className="p-2 bg-black bg-opacity-60 rounded-full hover:bg-opacity-80"
                          >
                            <PinOff size={20} />
                          </button>
                        </div>
                        
                        {/* Present name tag */}
                        <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black bg-opacity-60 rounded-md">
                          {participant.isLocal ? 'Your presentation' : `${participant.name}'s presentation`}
                        </div>
                      </div>
                    ))}
                </div>
                
                {/* Participant videos - right side, 20% width */}
                <div className="w-[20%] h-full p-2 flex flex-col gap-2 overflow-y-auto bg-gray-900 border-l border-gray-800">
                  <h3 className="text-sm font-medium text-gray-300 mb-2 px-1">Participants</h3>
                  {getOrderedParticipants().map(participant => (
                    <div 
                      key={participant.id}
                      className="aspect-video relative rounded-lg overflow-hidden border border-gray-700 flex-shrink-0 group"
                    >
                      {participant.isLocal ? (
                        <video
                          ref={(el) => {
                            if (el) {
                              if (streamRef.current && !isVideoOff) {
                                el.srcObject = streamRef.current;
                                el.muted = true;
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
                            if (el) {
                              peerVideoRefs.current.set(participant.id, el);
                              if (participant.videoStream) {
                                el.srcObject = participant.videoStream;
                              }
                            }
                          }}
                          autoPlay
                          playsInline
                          className="w-full h-full object-cover bg-black"
                        />
                      )}
                      
                      {/* Name tag */}
                      <div className="absolute bottom-1 left-1 right-1 text-xs px-1.5 py-0.5 bg-black bg-opacity-60 rounded-sm truncate">
                        {participant.name}
                      </div>
                      
                      {/* Indicators */}
                      {participant.isLocal && isMuted && (
                        <div className="absolute top-1 left-1 bg-red-600 rounded-sm p-0.5">
                          <MicOff size={12} />
                        </div>
                      )}
                      
                      {/* Video off indicator only when explicitly turned off */}
                      {((participant.isLocal && isVideoOff) || (!participant.hasVideo && !participant.isLocal)) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                          <div className="rounded-full bg-gray-700 w-16 h-16 flex items-center justify-center text-xl font-medium">
                            {participant.name.charAt(0).toUpperCase()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Regular video grid when no screen sharing */}
            {!getOrderedParticipants().some(p => p.screenStream) && (
              <>
                {pinnedPeerId ? (
                  // Meet-style pinned layout with sidebar - 80/20 split
                  <div className="absolute inset-0 flex flex-row">
                    {/* Pinned participant on the left - 80% of space */}
                    <div className="w-[80%] h-full p-2 bg-black">
                      {getOrderedParticipants()
                        .filter(p => p.id === pinnedPeerId)
                        .map(participant => (
                          <div 
                            key={participant.id}
                            className="relative h-full w-full flex items-center justify-center bg-black"
                          >
                            {participant.isLocal ? (
                              <video
                                ref={(el) => {
                                  if (el) {
                                    if (streamRef.current && !isVideoOff) {
                                      el.srcObject = streamRef.current;
                                      el.muted = true;
                                    }
                                  }
                                }}
                                autoPlay
                                playsInline
                                muted
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <video
                                ref={el => {
                                  if (el) {
                                    peerVideoRefs.current.set(participant.id, el);
                                    if (participant.videoStream) {
                                      el.srcObject = participant.videoStream;
                                    }
                                  }
                                }}
                                autoPlay
                                playsInline
                                className="max-h-full max-w-full object-contain"
                              />
                            )}
                            
                            {/* Unpin button */}
                            <div className="absolute top-4 right-4">
                              <button 
                                onClick={() => togglePin(null)} 
                                className="p-2 bg-black bg-opacity-60 rounded-full hover:bg-opacity-80"
                              >
                                <PinOff size={20} />
                              </button>
                            </div>
                            
                            {/* Name tag */}
                            <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black bg-opacity-60 rounded-md">
                              {participant.name}
                            </div>
                          </div>
                        ))}
                    </div>
                    
                    {/* Sidebar with other participants on the right - 20% of space */}
                    <div className="w-[20%] h-full p-2 flex flex-col gap-2 overflow-y-auto bg-gray-900 border-l border-gray-800">
                      <h3 className="text-sm font-medium text-gray-300 mb-2 px-1">Participants</h3>
                      {getOrderedParticipants()
                        .filter(p => p.id !== pinnedPeerId)
                        .map(participant => (
                          <div 
                            key={participant.id}
                            className="aspect-video relative rounded-lg overflow-hidden border border-gray-700 flex-shrink-0 group"
                          >
                            {participant.isLocal ? (
                              <video
                                ref={(el) => {
                                  if (el) {
                                    if (streamRef.current && !isVideoOff) {
                                      el.srcObject = streamRef.current;
                                      el.muted = true;
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
                                  if (el) {
                                    peerVideoRefs.current.set(participant.id, el);
                                    if (participant.videoStream) {
                                      el.srcObject = participant.videoStream;
                                    }
                                  }
                                }}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover bg-black"
                              />
                            )}
                            
                            {/* Name tag */}
                            <div className="absolute bottom-1 left-1 right-1 text-xs px-1.5 py-0.5 bg-black bg-opacity-60 rounded-sm truncate">
                              {participant.name}
                            </div>
                            
                            {/* Pin button - always visible on hover */}
                            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => togglePin(participant.id)} 
                                className="p-1 bg-black bg-opacity-60 rounded-full hover:bg-opacity-80"
                              >
                                <Pin size={14} />
                              </button>
                            </div>
                            
                            {/* Indicators */}
                            {participant.isLocal && isMuted && (
                              <div className="absolute top-1 left-1 bg-red-600 rounded-sm p-0.5">
                                <MicOff size={12} />
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  // Google Meet style grid
                  <div className="absolute inset-0 p-2">
                    <div className={cn(
                      "h-full grid gap-2",
                      getOrderedParticipants().length <= 1 ? "grid-cols-1" : 
                      getOrderedParticipants().length <= 2 ? "grid-cols-2" :
                      getOrderedParticipants().length <= 4 ? "grid-cols-2" :
                      getOrderedParticipants().length <= 9 ? "grid-cols-3" : "grid-cols-4"
                    )}>
                      {getOrderedParticipants().map(participant => (
                        <div 
                          key={participant.id}
                          className="relative rounded-lg overflow-hidden border border-gray-700 bg-black"
                        >
                          {participant.isLocal ? (
                            <video
                              ref={(el) => {
                                if (el) {
                                  if (streamRef.current && !isVideoOff) {
                                    el.srcObject = streamRef.current;
                                    el.muted = true;
                                  }
                                }
                              }}
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <video
                              ref={el => {
                                if (el) {
                                  peerVideoRefs.current.set(participant.id, el);
                                  if (participant.videoStream) {
                                    el.srcObject = participant.videoStream;
                                  }
                                }
                              }}
                              autoPlay
                              playsInline
                              className="w-full h-full object-cover"
                            />
                          )}
                          
                          {/* Hover overlay with controls */}
                          <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                            <div className="flex justify-end">
                              <button 
                                onClick={() => togglePin(participant.id)} 
                                className="p-2 bg-black bg-opacity-60 rounded-full"
                              >
                                <Pin size={16} />
                              </button>
                            </div>
                            
                            <div className="px-2 py-1 bg-black bg-opacity-60 rounded-md self-start">
                              {participant.name} {participant.isLocal && isMuted && <MicOff size={14} className="inline ml-1" />}
                            </div>
                          </div>
                          
                          {/* Video off indicator */}
                          {((participant.isLocal && isVideoOff) || (!participant.hasVideo && !participant.isLocal)) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                              <div className="rounded-full bg-gray-700 w-20 h-20 flex items-center justify-center text-2xl font-medium">
                                {participant.name.charAt(0).toUpperCase()}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            
            {/* Hidden audio elements */}
            <div className="hidden">
              {peers.map((peer) => (
                peer.audioStream && (
                  <audio
                    key={`${peer.id}-audio`}
                    ref={setPeerAudioRef(peer.id)}
                    autoPlay
                    playsInline
                  />
                )
              ))}
            </div>
          </div>
          
          {/* Bottom control bar - fixed 20% height */}
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
                      <Users size={16} className="mr-2" /> Participants ({peers.length + 1})
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
        </div>
      )}
    </div>
  );
}

export default App;
