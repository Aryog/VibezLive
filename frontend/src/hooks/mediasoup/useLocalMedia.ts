import { useState, useCallback, useRef } from 'react';

export const useLocalMedia = () => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const getLocalStream = useCallback(async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(localStream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      return localStream;
    } catch (error) {
      console.error('Failed to get local stream:', error);
      return null;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (stream) {
      stream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
      setIsMuted(prev => !prev);
    }
  }, [stream]);

  const toggleVideo = useCallback(() => {
    if (stream) {
      stream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
      setIsVideoOff(prev => !prev);
    }
  }, [stream]);

  return { stream, localVideoRef, isMuted, isVideoOff, getLocalStream, toggleMute, toggleVideo };
};
