import { useState, useRef, useCallback } from 'react';
import { types } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

export const useProducers = (producerTransport: types.Transport | null, socket: Socket | null) => {
  const [videoProducer, setVideoProducer] = useState<types.Producer | null>(null);
  const [audioProducer, setAudioProducer] = useState<types.Producer | null>(null);
  const [screenProducer, setScreenProducer] = useState<types.Producer | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const publishStream = useCallback(async (stream: MediaStream) => {
    if (!producerTransport) return;

    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const videoProducer = await producerTransport.produce({ track: videoTrack });
        setVideoProducer(videoProducer);
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const audioProducer = await producerTransport.produce({ track: audioTrack });
        setAudioProducer(audioProducer);
      }
      console.log('Stream published');
    } catch (error) {
      console.error('Failed to publish stream:', error);
    }
  }, [producerTransport]);

  const toggleScreenShare = useCallback(async () => {
    if (!producerTransport) return;

    if (screenProducer) {
      // Stop screen sharing
      const producerId = screenProducer.id;
      screenProducer.close();
      setScreenProducer(null);
      screenStreamRef.current?.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
      
      // Notify backend that producer is closed
      if (socket) {
        socket.emit('closeProducer', { producerId });
      }
      
      console.log('Screen share stopped');
    } else {
      // Start screen sharing
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];
        const newScreenProducer = await producerTransport.produce({ 
          track: screenTrack,
          appData: { mediaType: 'screen' }
        });
        setScreenProducer(newScreenProducer);

        screenTrack.onended = () => {
          const producerId = newScreenProducer.id;
          newScreenProducer.close();
          setScreenProducer(null);
          
          // Notify backend that producer is closed
          if (socket) {
            socket.emit('closeProducer', { producerId });
          }
          
          console.log('Screen share stopped by browser UI');
        };
        console.log('Screen share started');
      } catch (error) {
        console.error('Failed to start screen share:', error);
      }
    }
  }, [producerTransport, screenProducer, socket]);

  return { videoProducer, audioProducer, screenProducer, publishStream, toggleScreenShare };
};
