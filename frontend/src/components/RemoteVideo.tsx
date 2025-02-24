import React, { useRef, useEffect, useState } from "react";
import { Card } from "./ui/Card";

interface RemoteStream {
  stream: MediaStream;
  username: string;
  peerId: string;
  isActive: boolean;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
}

interface RemoteVideoProps {
  remoteStream: RemoteStream;
}

const RemoteVideo: React.FC<RemoteVideoProps> = ({ remoteStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackState, setPlaybackState] = useState<'connecting' | 'playing' | 'error'>('connecting');
  const currentStreamIdRef = useRef<string>("");
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);

  // Track component mount state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !remoteStream?.stream) return;

    const newStreamId = remoteStream.stream.id;
    if (newStreamId === currentStreamIdRef.current) return;

    let cleanupFunctions: Array<() => void> = [];

    const setupStream = async () => {
      try {
        // Clean up existing stream if any
        if (videoElement.srcObject) {
          const oldStream = videoElement.srcObject as MediaStream;
          oldStream.getTracks().forEach(track => track.stop());
          videoElement.srcObject = null;
        }

        // Reset state
        setPlaybackState('connecting');
        currentStreamIdRef.current = newStreamId;

        // Set up new stream
        videoElement.srcObject = remoteStream.stream;

        // Handle track events
        const handleTrackEvent = () => {
          if (mountedRef.current) {
            attemptPlay();
          }
        };

        remoteStream.stream.addEventListener('addtrack', handleTrackEvent);
        remoteStream.stream.addEventListener('removetrack', handleTrackEvent);

        cleanupFunctions.push(() => {
          remoteStream.stream.removeEventListener('addtrack', handleTrackEvent);
          remoteStream.stream.removeEventListener('removetrack', handleTrackEvent);
        });

        // Attempt playback with proper promise handling
        const attemptPlay = async (retryCount = 0) => {
          if (!mountedRef.current) return;

          try {
            // Cancel any existing play promise
            if (playPromiseRef.current) {
              await playPromiseRef.current.catch(() => {});
            }

            // Start new playback attempt
            if (videoElement.paused) {
              playPromiseRef.current = videoElement.play();
              await playPromiseRef.current;
              
              if (mountedRef.current) {
                setPlaybackState('playing');
              }
            }
          } catch (error) {
            if (!mountedRef.current) return;

            console.warn(`Play attempt ${retryCount + 1} failed:`, error);
            
            // Check if the error is due to interruption
            if (error instanceof DOMException && 
               (error.message.includes('interrupted') || error.message.includes('aborted'))) {
              
              // Wait briefly before retrying
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              if (retryCount < 3 && mountedRef.current) {
                attemptPlay(retryCount + 1);
              } else {
                setPlaybackState('error');
              }
            } else {
              setPlaybackState('error');
            }
          }
        };

        // Initial playback attempt
        await attemptPlay();

        // Handle video element events
        const handlePause = () => {
          if (mountedRef.current && playbackState === 'playing') {
            attemptPlay();
          }
        };

        const handleError = () => {
          if (mountedRef.current) {
            setPlaybackState('error');
          }
        };

        videoElement.addEventListener('pause', handlePause);
        videoElement.addEventListener('error', handleError);

        cleanupFunctions.push(() => {
          videoElement.removeEventListener('pause', handlePause);
          videoElement.removeEventListener('error', handleError);
        });

      } catch (error) {
        console.error('Stream setup error:', error);
        if (mountedRef.current) {
          setPlaybackState('error');
        }
      }
    };

    setupStream();

    // Cleanup function
    return () => {
      cleanupFunctions.forEach(cleanup => cleanup());
      
      if (videoElement.srcObject) {
        const oldStream = videoElement.srcObject as MediaStream;
        oldStream.getTracks().forEach(track => track.stop());
        videoElement.srcObject = null;
      }
    };
  }, [remoteStream?.stream, playbackState]);

  const handleRetry = async () => {
    const videoElement = videoRef.current;
    if (!videoElement || !remoteStream?.stream) return;

    setPlaybackState('connecting');
    videoElement.srcObject = remoteStream.stream;

    try {
      await videoElement.play();
      if (mountedRef.current) {
        setPlaybackState('playing');
      }
    } catch (error) {
      console.error('Retry failed:', error);
      if (mountedRef.current) {
        setPlaybackState('error');
      }
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted={!remoteStream?.audioTrack}
        className="w-full h-full object-cover aspect-video bg-gray-900"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white p-2 flex items-center justify-between">
        <span className="text-sm font-medium">{remoteStream?.username || 'Unknown'}</span>
        <div className="flex items-center gap-2">
          {playbackState === 'error' && (
            <button 
              onClick={handleRetry}
              className="text-xs bg-blue-500 px-2 py-1 rounded hover:bg-blue-600"
            >
              Retry
            </button>
          )}
          {!remoteStream?.videoTrack && (
            <span className="text-xs bg-yellow-500 px-2 py-1 rounded">Video Off</span>
          )}
          {!remoteStream?.audioTrack && (
            <span className="text-xs bg-red-500 px-2 py-1 rounded">Muted</span>
          )}
          {playbackState === 'connecting' && (
            <span className="text-xs bg-yellow-500 px-2 py-1 rounded">Connecting...</span>
          )}
          {playbackState === 'playing' && (
            <span className="text-xs bg-green-500 px-2 py-1 rounded">Live</span>
          )}
        </div>
      </div>
    </Card>
  );
};

export default RemoteVideo;