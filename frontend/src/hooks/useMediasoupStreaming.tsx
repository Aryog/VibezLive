import { useState, useEffect } from 'react';
import { 
  useSocket, 
  useMediasoupDevice, 
  useTransports, 
  useProducers, 
  useConsumers, 
  useLocalMedia,
} from './mediasoup';

export function useMediasoupStreaming() {
  const [roomId, setRoomId] = useState('');

  // Use modular hooks
  const { socket, isConnected } = useSocket(roomId);
  const device = useMediasoupDevice(socket);
  const { producerTransport, consumerTransport } = useTransports(device, socket);
  const { screenProducer, publishStream, toggleScreenShare } = useProducers(producerTransport);
  const peers = useConsumers(device, socket, consumerTransport);
  const { stream, localVideoRef, isMuted, isVideoOff, getLocalStream, toggleMute, toggleVideo } = useLocalMedia();

  useEffect(() => {
    getLocalStream();
  }, [getLocalStream]);

  // Publish stream when transport is ready
  useEffect(() => {
    if (stream && producerTransport && isConnected) {
      publishStream(stream);
    }
  }, [stream, producerTransport, isConnected, publishStream]);

  // Join room handler
  const handleJoinRoom = async () => {
    if (!roomId) return;
    await getLocalStream();
  };


  const setPeerVideoRef = () => {
    // This is handled internally by the video elements now
  };

  return {
    // State
    roomId,
    setRoomId,
    isConnected,
    isMuted,
    isVideoOff,
    peers,
    isScreenSharing: !!screenProducer,
    
    // Refs
    localVideoRef,
    streamRef: { current: stream },
    screenStreamRef: { current: null }, // Managed internally by useProducers
    
    // Functions
    handleJoinRoom,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    setPeerVideoRef,
  };
}
