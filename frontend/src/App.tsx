import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  isSpeaking?: boolean;
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
  const [activeSpeakers, setActiveSpeakers] = useState<Record<string, boolean>>({});
  const audioAnalysersRef = useRef<Map<string, { analyser: AnalyserNode, dataArray: Uint8Array }>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

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

  // Initialize audio context for detecting speakers
  useEffect(() => {
    if (isConnected && !audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [isConnected]);
  
  // Set up audio analyzers for peers to detect speaking
  useEffect(() => {
    if (!audioContextRef.current) return;
    
    // Clean up old analyzers for peers that are no longer connected
    const currentPeerIds = new Set(peers.map(peer => peer.id));
    Array.from(audioAnalysersRef.current.keys()).forEach(peerId => {
      if (!currentPeerIds.has(peerId)) {
        audioAnalysersRef.current.delete(peerId);
      }
    });
    
    // Create new analyzers for peers
    peers.forEach(peer => {
      if (peer.audioStream && !audioAnalysersRef.current.has(peer.id)) {
        try {
          const audioContext = audioContextRef.current as AudioContext;
          const source = audioContext.createMediaStreamSource(peer.audioStream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          audioAnalysersRef.current.set(peer.id, { analyser, dataArray });
        } catch (error) {
          console.error("Error creating audio analyzer:", error);
        }
      }
    });
  }, [peers]);
  
  // Check audio levels to detect speaking
  useEffect(() => {
    if (!isConnected || audioAnalysersRef.current.size === 0) return;
    
    const checkAudioLevels = () => {
      const newActiveSpeakers: Record<string, boolean> = {};
      let hasChanges = false;
      
      audioAnalysersRef.current.forEach(({ analyser, dataArray }, peerId) => {
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume level
        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        
        // Consider speaking if above threshold (adjust as needed)
        const isSpeaking = average > 25; // Higher threshold to reduce flicker
        newActiveSpeakers[peerId] = isSpeaking;
        
        // Check if this specific speaker state changed
        if (activeSpeakers[peerId] !== isSpeaking) {
          hasChanges = true;
        }
      });
      
      // Only update state if there are actual changes
      if (hasChanges) {
        setActiveSpeakers(newActiveSpeakers);
      }
    };
    
    const intervalId = setInterval(checkAudioLevels, 500);
    return () => clearInterval(intervalId);
  }, [isConnected, peers]);

  // Pin/unpin participant
  const togglePin = (id: string | null) => {
    if (pinnedPeerId === id) {
      setPinnedPeerId(null);
    } else {
      setPinnedPeerId(id);
    }
  };

  // Get participants in the right order with speaking status
  const getOrderedParticipants = (): Participant[] => {
    const participants: Participant[] = [
      { 
        id: 'local', 
        videoRef: localVideoRef as React.RefObject<HTMLVideoElement>,
        isLocal: true,
        hasVideo: !isVideoOff,
        videoStream: streamRef.current,
        screenStream: isScreenSharing ? screenStreamRef.current : null,
        name: 'You',
        isSpeaking: false
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
        name: `User ${peer.id.slice(0, 4)}`,
        isSpeaking: activeSpeakers[peer.id] || false
      });
    });

    return participants;
  };

  // Leave meeting
  const leaveMeeting = () => {
    window.location.reload();
  };

  // Use useMemo for expensive calculations
  const orderedParticipants = useMemo(() => {
    return getOrderedParticipants();
  }, [peers, isVideoOff, isMuted, streamRef.current, screenStreamRef.current, isScreenSharing, activeSpeakers]);

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
            {orderedParticipants.some(p => p.screenStream) && (
              <div className="absolute inset-0 flex flex-row">
                {/* Screen share video - left side, 80% width */}
                <div className="w-[80%] h-full relative">
                  {orderedParticipants
                    .filter(p => p.screenStream)
                    .map(participant => (
                      <div key={`screen-${participant.id}`} className="absolute inset-0">
                        <video
                          ref={(el) => {
                            if (el && (!el.srcObject || el.srcObject !== (participant.isLocal ? screenStreamRef.current : participant.screenStream))) {
                              try {
                                const stream = participant.isLocal ? screenStreamRef.current : participant.screenStream;
                                if (stream) {
                                  el.srcObject = stream;
                                  // Set playback quality for smoother playback
                                  el.style.transform = 'translate3d(0,0,0)'; // Force GPU acceleration
                                }
                              } catch (error) {
                                console.error('Error setting screen share source:', error);
                              }
                            }
                          }}
                          autoPlay
                          playsInline
                          className="w-full h-full object-contain bg-black"
                          style={{ 
                            willChange: 'transform', // Optimize for animations
                            backfaceVisibility: 'hidden' // Prevent flickering in some browsers
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
                  {orderedParticipants.map(participant => (
                    <div 
                      key={participant.id}
                      className={cn(
                        "aspect-video relative rounded-lg overflow-hidden border-2",
                        participant.isSpeaking ? "border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.5)]" : "border-gray-700"
                      )}
                    >
                      {participant.isLocal ? (
                        <video
                          ref={(el) => {
                            if (el && (!el.srcObject || el.srcObject !== streamRef.current) && streamRef.current && !isVideoOff) {
                              try {
                                el.srcObject = streamRef.current;
                                el.muted = true;  // Always mute local video
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
                              peerVideoRefs.current.set(participant.id, el);
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
                      
                      {/* Name tag */}
                      <div className="absolute bottom-1 left-1 right-1 text-xs px-1.5 py-0.5 bg-black bg-opacity-60 rounded-sm truncate flex items-center justify-between">
                        <span>{participant.name}</span>
                        {participant.isSpeaking && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_5px_rgba(74,222,128,0.8)]"></span>
                          </span>
                        )}
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
            {!orderedParticipants.some(p => p.screenStream) && (
              <>
                {pinnedPeerId ? (
                  // Meet-style pinned layout with sidebar - 80/20 split
                  <div className="absolute inset-0 flex flex-row">
                    {/* Pinned participant on the left - 80% of space */}
                    <div className="w-[80%] h-full p-2 bg-black">
                      {orderedParticipants
                        .filter(p => p.id === pinnedPeerId)
                        .map(participant => (
                          <div 
                            key={participant.id}
                            className={cn(
                              "relative h-full w-full flex items-center justify-center bg-black rounded-lg border-2",
                              participant.isSpeaking ? "border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.5)]" : "border-gray-700"
                            )}
                          >
                            {participant.isLocal ? (
                              <video
                                ref={(el) => {
                                  if (el && (!el.srcObject || el.srcObject !== streamRef.current) && streamRef.current && !isVideoOff) {
                                    try {
                                      el.srcObject = streamRef.current;
                                      el.muted = true;  // Always mute local video
                                    } catch (error) {
                                      console.error('Error setting local video source:', error);
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
                                  if (el && (!el.srcObject || el.srcObject !== participant.videoStream) && participant.videoStream) {
                                    el.srcObject = participant.videoStream;
                                    peerVideoRefs.current.set(participant.id, el);
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
                            <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black bg-opacity-60 rounded-md flex items-center">
                              {participant.name}
                              {participant.isSpeaking && (
                                <div className="flex items-center gap-1 bg-green-400/20 px-2 py-0.5 rounded-full">
                                  <Mic size={12} className="text-green-400" />
                                  <span className="text-xs text-green-400">Speaking</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                    
                    {/* Sidebar with other participants on the right - 20% of space */}
                    <div className="w-[20%] h-full p-2 flex flex-col gap-2 overflow-y-auto bg-gray-900 border-l border-gray-800">
                      <h3 className="text-sm font-medium text-gray-300 mb-2 px-1">Participants</h3>
                      {orderedParticipants
                        .filter(p => p.id !== pinnedPeerId)
                        .map(participant => (
                          <div 
                            key={participant.id}
                            className={cn(
                              "aspect-video relative rounded-lg overflow-hidden border-2",
                              participant.isSpeaking ? "border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.5)]" : "border-gray-700"
                            )}
                          >
                            {participant.isLocal ? (
                              <video
                                ref={(el) => {
                                  if (el && (!el.srcObject || el.srcObject !== streamRef.current) && streamRef.current && !isVideoOff) {
                                    try {
                                      el.srcObject = streamRef.current;
                                      el.muted = true;  // Always mute local video
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
                                    peerVideoRefs.current.set(participant.id, el);
                                  }
                                }}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover bg-black"
                              />
                            )}
                            
                            {/* Speaking indicator */}
                            {participant.isSpeaking && (
                              <div className="absolute top-1 right-1 bg-green-400 rounded-full p-1 z-10 shadow-[0_0_8px_rgba(74,222,128,0.6)] backdrop-blur-sm">
                                <Mic size={12} className="text-black" />
                              </div>
                            )}
                            
                            {/* Name tag */}
                            <div className="absolute bottom-1 left-1 right-1 text-xs px-1.5 py-0.5 bg-black bg-opacity-60 rounded-sm truncate flex items-center justify-between">
                              <span>{participant.name}</span>
                              {participant.isSpeaking && (
                                <span className="flex items-center gap-1">
                                  <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_5px_rgba(74,222,128,0.8)]"></span>
                                </span>
                              )}
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
                      orderedParticipants.length <= 1 ? "grid-cols-1" : 
                      orderedParticipants.length <= 2 ? "grid-cols-2" :
                      orderedParticipants.length <= 4 ? "grid-cols-2" :
                      orderedParticipants.length <= 9 ? "grid-cols-3" : "grid-cols-4"
                    )}>
                      {orderedParticipants.map(participant => (
                        <div 
                          key={participant.id}
                          className={cn(
                            "relative rounded-lg overflow-hidden border-2",
                            participant.isSpeaking ? "border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.5)]" : "border-gray-700"
                          )}
                        >
                          {participant.isLocal ? (
                            <video
                              ref={(el) => {
                                if (el && (!el.srcObject || el.srcObject !== streamRef.current) && streamRef.current && !isVideoOff) {
                                  try {
                                    el.srcObject = streamRef.current;
                                    el.muted = true;  // Always mute local video
                                  } catch (error) {
                                    console.error('Error setting local video source:', error);
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
                                if (el && (!el.srcObject || el.srcObject !== participant.videoStream) && participant.videoStream) {
                                  el.srcObject = participant.videoStream;
                                  peerVideoRefs.current.set(participant.id, el);
                                }
                              }}
                              autoPlay
                              playsInline
                              className="w-full h-full object-cover"
                            />
                          )}
                          
                          {/* Speaking indicator */}
                          {participant.isSpeaking && (
                            <div className="absolute top-2 right-2 bg-green-400 rounded-full p-1.5 shadow-[0_0_10px_rgba(74,222,128,0.7)] backdrop-blur-sm">
                              <Mic size={14} className="text-black" />
                            </div>
                          )}
                          
                          {/* Hover overlay with controls */}
                          <div className="absolute inset-0 flex flex-col justify-between p-2">
                            <div className="flex justify-between items-start">
                              {/* Top-left indicators (mute, video off) */}
                              <div className="flex gap-1">
                                {participant.isLocal && isMuted && (
                                  <div className="p-1.5 bg-red-600 rounded-md">
                                    <MicOff size={16} />
                                  </div>
                                )}
                                {((participant.isLocal && isVideoOff) || (!participant.hasVideo && !participant.isLocal)) && (
                                  <div className="p-1.5 bg-red-600 rounded-md">
                                    <VideoOff size={16} />
                                  </div>
                                )}
                              </div>
                              
                              {/* Top-right pin button */}
                              {!participant.isLocal && (
                                <button 
                                  onClick={() => togglePin(participant.id)} 
                                  className="p-1.5 bg-black bg-opacity-60 rounded-md hover:bg-opacity-80"
                                >
                                  <Pin size={16} />
                                </button>
                              )}
                            </div>
                            
                            {/* Bottom name tag and speaking indicator */}
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
