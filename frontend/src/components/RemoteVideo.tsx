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

    // Ensure tracks are enabled and active
    remoteStream.stream.getTracks().forEach(track => {
      console.log(`Track state:`, {
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });
      
      track.enabled = true;
      
      // Add track event listeners
      track.onended = () => {
        console.log(`Track ${track.kind} ended`);
        if (mountedRef.current) {
          setPlaybackState('error');
        }
      };

      track.onmute = () => {
        console.log(`Track ${track.kind} muted`);
      };

      track.onunmute = () => {
        console.log(`Track ${track.kind} unmuted`);
        attemptPlay();
      };
    });

    const newStreamId = remoteStream.stream.id;
    if (newStreamId === currentStreamIdRef.current) return;

    const setupStream = async () => {
      try {
        // Clean up existing stream
        if (videoElement.srcObject) {
          const oldStream = videoElement.srcObject as MediaStream;
          oldStream.getTracks().forEach(track => track.stop());
          videoElement.srcObject = null;
        }

        // Reset state and set new stream
        setPlaybackState('connecting');
        currentStreamIdRef.current = newStreamId;
        
        // Ensure we have active tracks before setting srcObject
        const activeTracks = remoteStream.stream.getTracks().filter(t => t.readyState === 'live');
        if (activeTracks.length === 0) {
          throw new Error('No active tracks available');
        }

        videoElement.srcObject = remoteStream.stream;
        videoElement.load();
        
        await attemptPlay();

      } catch (error) {
        console.error('Stream setup error:', error);
        if (mountedRef.current) {
          setPlaybackState('error');
        }
      }
    };

    setupStream();

    return () => {
      if (videoElement.srcObject) {
        const oldStream = videoElement.srcObject as MediaStream;
        oldStream.getTracks().forEach(track => {
          track.onended = null;
          track.onmute = null;
          track.onunmute = null;
          track.stop();
        });
        videoElement.srcObject = null;
      }
    };
  }, [remoteStream?.stream]);

  const attemptPlay = async (retryCount = 0) => {
    const videoElement = videoRef.current;
    if (!videoElement || !remoteStream?.stream) return;

    try {
      // Cancel any existing play promise
      if (playPromiseRef.current) {
        await playPromiseRef.current.catch(() => {});
      }

      // Add a small delay before attempting to play
      await new Promise(resolve => setTimeout(resolve, 100));

      // Start new playback attempt
      if (videoElement.paused) {
        console.log('Attempting to play video:', {
          streamId: remoteStream.stream.id,
          attempt: retryCount + 1
        });
        
        playPromiseRef.current = videoElement.play();
        await playPromiseRef.current;

        if (mountedRef.current) {
          setPlaybackState('playing');
          console.log('Video playing successfully');
        }
      }
    } catch (error) {
      if (!mountedRef.current) return;

      console.warn(`Play attempt ${retryCount + 1} failed:`, error);

      // Increase retry delay and attempts
      if (retryCount < 5) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        if (mountedRef.current) {
          attemptPlay(retryCount + 1);
        }
      } else {
        setPlaybackState('error');
      }
    }
  };

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
        onLoadedMetadata={() => console.log('Video metadata loaded')}
        onPlay={() => console.log('Video started playing')}
        onError={(e) => console.error('Video error:', e)}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white p-2 flex items-center justify-between">
        <span className="text-sm font-medium">
          {remoteStream?.username || 'Unknown'} 
          <span className="text-xs ml-2">
            ({remoteStream?.videoTrack ? '📹' : '❌'} | 
            {remoteStream?.audioTrack ? '🎤' : '❌'})
          </span>
        </span>
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