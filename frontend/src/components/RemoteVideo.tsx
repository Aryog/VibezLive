import { useRef, useEffect, useCallback, useState } from 'react';

const RemoteVideo = ({ remoteStream }: { remoteStream: { stream: MediaStream; username: string } }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const playAttemptRef = useRef<number>(0);

  const startPlayback = useCallback(async () => {
    if (!videoRef.current || !remoteStream.stream) return;
    
    try {
      setHasError(false);
      
      // Only set srcObject if it's different
      if (videoRef.current.srcObject !== remoteStream.stream) {
        videoRef.current.srcObject = remoteStream.stream;
      }
      
      // Check if video is already playing
      if (!videoRef.current.paused) {
        setIsPlaying(true);
        return;
      }

      // Increment attempt counter
      playAttemptRef.current += 1;

      // Wait for loadedmetadata
      if (videoRef.current.readyState < 2) {
        await new Promise((resolve) => {
          const handleLoaded = () => {
            videoRef.current?.removeEventListener('loadedmetadata', handleLoaded);
            resolve(null);
          };
          videoRef.current?.addEventListener('loadedmetadata', handleLoaded);
        });
      }

      await videoRef.current.play();
      setIsPlaying(true);
      playAttemptRef.current = 0;
    } catch (error) {
      console.error('Playback error:', error);
      setHasError(true);
      setIsPlaying(false);

      // Retry logic
      if (playAttemptRef.current < 3) {
        setTimeout(startPlayback, 1000);
      }
    }
  }, [remoteStream.stream]);

  useEffect(() => {
    startPlayback();
    
    const video = videoRef.current;
    return () => {
      if (video) {
        video.srcObject = null;
        setIsPlaying(false);
        playAttemptRef.current = 0;
      }
    };
  }, [startPlayback]);

  return (
    <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white p-2">
        <span className="text-sm font-medium">{remoteStream.username}</span>
        {hasError ? (
          <span className="ml-2 text-xs bg-red-500 px-2 py-1 rounded">Error</span>
        ) : !isPlaying ? (
          <span className="ml-2 text-xs bg-yellow-500 px-2 py-1 rounded">Connecting...</span>
        ) : (
          <span className="ml-2 text-xs bg-green-500 px-2 py-1 rounded">Live</span>
        )}
      </div>
    </div>
  );
};

export default RemoteVideo;