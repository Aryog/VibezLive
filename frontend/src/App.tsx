import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PinOff } from 'lucide-react';
import { cn } from './lib/utils';
import { useMediasoupStreaming } from './hooks/useMediasoupStreaming';
import { PreMeeting } from './components/PreMeeting';
import { ControlBar } from './components/ControlBar';
import { ParticipantVideo } from './components/ParticipantVideo';

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
    isScreenSharing,
    localVideoRef,
    screenStreamRef,
    streamRef,
    handleJoinRoom,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
  } = useMediasoupStreaming();

  // Check URL parameters for room ID on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setRoomId(roomParam);
    }
  }, [setRoomId]);

  // State
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const peerVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const [activeSpeakers, setActiveSpeakers] = useState<Record<string, boolean>>({});
  const audioAnalysersRef = useRef<Map<string, { analyser: AnalyserNode, dataArray: Uint8Array }>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

  // Audio analysis setup and monitoring
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
  
  useEffect(() => {
    if (!audioContextRef.current) return;

    const currentPeerIds = new Set(peers.map(p => p.id));
    // Clean up old analysers
    Array.from(audioAnalysersRef.current.keys()).forEach(peerId => {
      if (!currentPeerIds.has(peerId)) {
        audioAnalysersRef.current.delete(peerId);
      }
    });

    peers.forEach(peer => {
      if (peer.audioStream && peer.audioRef?.current && !peer.audioRef.current.srcObject) {
        peer.audioRef.current.srcObject = peer.audioStream;
      }

      // Set up audio analyser for speaking indicator
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
  
  useEffect(() => {
    if (!isConnected || audioAnalysersRef.current.size === 0) return;
    
    const checkAudioLevels = () => {
      const newActiveSpeakers: Record<string, boolean> = {};
      let hasChanges = false;
      
      audioAnalysersRef.current.forEach(({ analyser, dataArray }, peerId) => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        const isSpeaking = average > 25;
        newActiveSpeakers[peerId] = isSpeaking;
        
        if (activeSpeakers[peerId] !== isSpeaking) {
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        setActiveSpeakers(newActiveSpeakers);
      }
    };
    
    const intervalId = setInterval(checkAudioLevels, 500);
    return () => clearInterval(intervalId);
  }, [isConnected, peers]);

  // Pin/unpin participant
  const togglePin = (id: string | null) => {
    setPinnedPeerId(pinnedPeerId === id ? null : id);
  };

  // Get ordered participants
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

  const orderedParticipants = useMemo(() => {
    return getOrderedParticipants();
  }, [peers, isVideoOff, isMuted, streamRef.current, screenStreamRef.current, isScreenSharing, activeSpeakers]);

  // Leave meeting
  const leaveMeeting = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {!isConnected ? (
        <PreMeeting 
          roomId={roomId}
          setRoomId={setRoomId}
          handleJoinRoom={handleJoinRoom}
        />
      ) : (
        <div className="h-screen flex flex-col">
          <div className="flex-1 relative bg-black h-[80vh]">
            {/* Screen share layout */}
            {orderedParticipants.some(p => p.screenStream) && (
              <div className="absolute inset-0 flex flex-row">
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
                                  el.style.transform = 'translate3d(0,0,0)';
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
                            willChange: 'transform',
                            backfaceVisibility: 'hidden'
                          }}
                        />
                        
                        <div className="absolute top-4 right-4">
                          <button 
                            onClick={() => togglePin(null)} 
                            className="p-2 bg-black bg-opacity-60 rounded-full hover:bg-opacity-80"
                          >
                            <PinOff size={20} />
                          </button>
                        </div>
                        
                        <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-black bg-opacity-60 rounded-md">
                          {participant.isLocal ? 'Your presentation' : `${participant.name}'s presentation`}
                        </div>
                      </div>
                    ))}
                </div>
                
                <div className="w-[20%] h-full p-2 flex flex-col gap-2 overflow-y-auto bg-gray-900 border-l border-gray-800">
                  <h3 className="text-sm font-medium text-gray-300 mb-2 px-1">Participants</h3>
                  {orderedParticipants.map(participant => (
                    <ParticipantVideo
                      key={participant.id}
                      participant={participant}
                      isLocal={participant.isLocal}
                      isMuted={isMuted}
                      isVideoOff={isVideoOff}
                      onTogglePin={togglePin}
                      streamRef={streamRef}
                      setPeerVideoRef={(id, el) => el && peerVideoRefs.current.set(id, el)}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Regular video grid */}
            {!orderedParticipants.some(p => p.screenStream) && (
              <div className="absolute inset-0 p-2">
                <div className={cn(
                  "h-full grid gap-2",
                  orderedParticipants.length <= 1 ? "grid-cols-1" : 
                  orderedParticipants.length <= 2 ? "grid-cols-2" :
                  orderedParticipants.length <= 4 ? "grid-cols-2" :
                  orderedParticipants.length <= 9 ? "grid-cols-3" : "grid-cols-4"
                )}>
                  {orderedParticipants.map(participant => (
                    <ParticipantVideo
                      key={participant.id}
                      participant={participant}
                      isLocal={participant.isLocal}
                      isMuted={isMuted}
                      isVideoOff={isVideoOff}
                      onTogglePin={togglePin}
                      streamRef={streamRef}
                      setPeerVideoRef={(id, el) => el && peerVideoRefs.current.set(id, el)}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Hidden audio elements */}
            <div className="hidden">
              {peers.map((peer) => (
                peer.audioStream && (
                  <audio
                    key={`${peer.id}-audio`}
                    ref={peer.audioRef}
                    autoPlay
                    playsInline
                  />
                )
              ))}
            </div>
          </div>
          
          <ControlBar
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            isScreenSharing={isScreenSharing}
            showMenu={showMenu}
            roomId={roomId}
            toggleMute={toggleMute}
            toggleVideo={toggleVideo}
            toggleScreenShare={toggleScreenShare}
            setShowMenu={setShowMenu}
            leaveMeeting={leaveMeeting}
          />
        </div>
      )}
    </div>
  );
}

export default App;
