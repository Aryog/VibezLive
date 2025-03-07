import React, { useEffect, useRef, useState } from 'react';
import { Socket, io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Video, Mic, MicOff, VideoOff, Users } from 'lucide-react';
import { cn } from './lib/utils';

const SERVER_URL = 'http://localhost:3000';

interface Peer {
  id: string;
  videoStream?: MediaStream;
  audioStream?: MediaStream;
}

function App() {
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [transportReady, setTransportReady] = useState(false);

  const socketRef = useRef<Socket>();
  const deviceRef = useRef<Device>();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const producerTransportRef = useRef<any>(null);
  const consumerTransportRef = useRef<any>(null);
  const videoProducerRef = useRef<any>(null);
  const audioProducerRef = useRef<any>(null);
  const consumersRef = useRef<Map<string, any>>(new Map());
  const streamRef = useRef<MediaStream>();
  const peerVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const peerAudioRefs = useRef<Map<string, HTMLAudioElement | null>>(new Map());
  const pendingConsumersRef = useRef<string[]>([]);

  const setupConsumer = async (producerId: string) => {
    try {
      // Add a delay to ensure the device and transport are truly ready
      if (!deviceRef.current?.loaded || !deviceLoaded || !consumerTransportRef.current || !transportReady) {
        console.log('Device or transport not ready yet, adding to pending consumers queue');
        if (!pendingConsumersRef.current.includes(producerId)) {
          pendingConsumersRef.current.push(producerId);
        }
        return;
      }

      const { params } = await new Promise<any>((resolve) =>
        socketRef.current?.emit('consume', {
          producerId,
          rtpCapabilities: deviceRef.current?.rtpCapabilities
        }, resolve)
      );

      if (params.error) {
        console.error(params.error);
        return;
      }

      const consumer = await consumerTransportRef.current.consume(params);
      consumersRef.current.set(consumer.id, consumer);

      consumer.on('trackended', () => {
        removeConsumer(consumer.id);
      });

      consumer.on('transportclose', () => {
        removeConsumer(consumer.id);
      });

      const { track } = consumer;

      // Create a new MediaStream for this consumer
      const stream = new MediaStream([track]);

      // Update peers state with the new stream
      setPeers(prevPeers => {
        const peer = prevPeers.find(p => p.id === params.producerId);
        if (peer) {
          if (consumer.kind === 'video') {
            peer.videoStream = stream;
          } else {
            peer.audioStream = stream;
          }
          return [...prevPeers];
        }
        return [...prevPeers, { id: params.producerId, [consumer.kind === 'video' ? 'videoStream' : 'audioStream']: stream }];
      });

      await socketRef.current?.emit('resumeConsumer', { consumerId: consumer.id });
    } catch (error) {
      console.error('Error setting up consumer:', error);
    }
  };

  // Process pending consumers when device and transport are ready
  const processPendingConsumers = async () => {
    if (deviceLoaded && transportReady && consumerTransportRef.current && pendingConsumersRef.current.length > 0) {
      console.log(`Processing ${pendingConsumersRef.current.length} pending consumers`);
      const consumers = [...pendingConsumersRef.current];
      pendingConsumersRef.current = [];

      // Add a small delay to ensure everything is properly initialized
      await new Promise(resolve => setTimeout(resolve, 500));

      for (const producerId of consumers) {
        await setupConsumer(producerId);
      }
    }
  };

  const removeConsumer = (consumerId: string) => {
    const consumer = consumersRef.current.get(consumerId);
    if (consumer) {
      consumer.close();
      consumersRef.current.delete(consumerId);
    }
  };

  // Set video and audio srcObject imperatively
  useEffect(() => {
    // Set local video
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }

    // Update refs for peer media elements
    peers.forEach(peer => {
      const videoRef = peerVideoRefs.current.get(peer.id);
      if (videoRef && peer.videoStream) {
        videoRef.srcObject = peer.videoStream;
      }

      const audioRef = peerAudioRefs.current.get(peer.id);
      if (audioRef && peer.audioStream) {
        audioRef.srcObject = peer.audioStream;
      }
    });
  }, [peers]);

  // Process pending consumers when device is loaded and transport is ready
  useEffect(() => {
    if (deviceLoaded && transportReady) {
      processPendingConsumers();
    }
  }, [deviceLoaded, transportReady]);

  // Setup socket connection
  useEffect(() => {
    socketRef.current = io(SERVER_URL);

    socketRef.current.on('connect', () => {
      console.log('Connected to server');
    });

    socketRef.current.on('routerCapabilities', async ({ routerRtpCapabilities }) => {
      try {
        console.log('Received router capabilities, loading device');
        deviceRef.current = new Device();

        // Load device and set flag when done
        await deviceRef.current.load({ routerRtpCapabilities });
        setDeviceLoaded(true);
        console.log('Device loaded successfully');

        // Create transports only after device is loaded
        await createTransports();
      } catch (error) {
        console.error('Failed to load device:', error);
      }
    });

    socketRef.current.on('newProducer', ({ producerId }) => {
      setupConsumer(producerId);
    });

    socketRef.current.on('newPeer', ({ peerId }) => {
      setPeers(prev => [...prev, { id: peerId }]);
    });

    socketRef.current.on('peerLeft', ({ peerId }) => {
      setPeers(prev => prev.filter(p => p.id !== peerId));
    });

    socketRef.current.on('currentProducers', ({ producerIds }) => {
      console.log(`Received ${producerIds.length} current producers`);

      for (const producerId of producerIds) {
        if (!pendingConsumersRef.current.includes(producerId)) {
          // Either set up the consumer if we're ready, or queue it
          if (deviceLoaded && transportReady && consumerTransportRef.current) {
            setupConsumer(producerId);
          } else {
            pendingConsumersRef.current.push(producerId);
            console.log(`Queued producer ${producerId} to be consumed later`);
          }
        }
      }
    });

    return () => {
      socketRef.current?.disconnect();
      streamRef.current?.getTracks().forEach(track => track.stop());

      // Close all transports
      if (producerTransportRef.current) {
        producerTransportRef.current.close();
      }

      if (consumerTransportRef.current) {
        consumerTransportRef.current.close();
      }
    };
  }, []);

  // Create consumer and producer transports
  const createTransports = async () => {
    if (!deviceRef.current || !deviceRef.current.loaded) {
      console.warn('Device not loaded, cannot create transports');
      return;
    }

    try {
      // Create consumer transport
      const { params: consumerParams } = await new Promise<any>((resolve) =>
        socketRef.current?.emit('createWebRtcTransport', { sender: false }, resolve)
      );

      consumerTransportRef.current = deviceRef.current.createRecvTransport(consumerParams);

      consumerTransportRef.current.on('connect', ({ dtlsParameters }, callback) => {
        socketRef.current?.emit('connectTransport', {
          dtlsParameters,
          sender: false
        });
        callback();
      });

      // Create producer transport
      const { params: producerParams } = await new Promise<any>((resolve) =>
        socketRef.current?.emit('createWebRtcTransport', { sender: true }, resolve)
      );

      producerTransportRef.current = deviceRef.current.createSendTransport(producerParams);

      producerTransportRef.current.on('connect', ({ dtlsParameters }, callback) => {
        socketRef.current?.emit('connectTransport', {
          dtlsParameters,
          sender: true
        });
        callback();
      });

      producerTransportRef.current.on('produce', async (parameters: any, callback: Function) => {
        const { producerId } = await new Promise<any>((resolve) =>
          socketRef.current?.emit('produce', parameters, resolve)
        );
        callback({ id: producerId });
      });

      // Mark transports as ready
      setTransportReady(true);
      console.log('Transports created successfully');

      // If we already have a stream, publish it
      if (streamRef.current) {
        await publishStream();
      }

      // Add a delay before processing consumers to ensure everything is properly initialized
      setTimeout(() => {
        processPendingConsumers();
      }, 1000);
    } catch (error) {
      console.error('Failed to create transports:', error);
    }
  };

  const publishStream = async () => {
    try {
      if (!streamRef.current || !producerTransportRef.current) {
        console.warn('Stream or producer transport not ready');
        return;
      }

      console.log('Publishing stream...');

      // Publish video
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoProducerRef.current = await producerTransportRef.current.produce({
          track: videoTrack,
          encodings: [
            { maxBitrate: 100000 },
            { maxBitrate: 300000 },
            { maxBitrate: 900000 }
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000
          }
        });
        console.log('Video track produced successfully');
      }

      // Publish audio
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioProducerRef.current = await producerTransportRef.current.produce({
          track: audioTrack
        });
        console.log('Audio track produced successfully');
      }
    } catch (error) {
      console.error('Failed to publish stream:', error);
    }
  };

  const handleJoinRoom = async () => {
    if (!roomId) return;

    try {
      console.log('Joining room:', roomId);

      // Get user media first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      streamRef.current = stream;

      // Set local video stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Join room on server
      socketRef.current?.emit('joinRoom', { roomId });
      setIsConnected(true);

      // If device is already loaded, publish the stream
      if (deviceLoaded && transportReady && producerTransportRef.current) {
        await publishStream();
      }
    } catch (error) {
      console.error('Error joining room:', error);
    }
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  // Function to set ref callback for video elements
  const setPeerVideoRef = (id: string) => (element: HTMLVideoElement | null) => {
    if (element) {
      peerVideoRefs.current.set(id, element);
    }
  };

  // Function to set ref callback for audio elements
  const setPeerAudioRef = (id: string) => (element: HTMLAudioElement | null) => {
    if (element) {
      peerAudioRefs.current.set(id, element);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {!isConnected ? (
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-96">
            <h1 className="text-2xl font-bold mb-6">Join Video Conference</h1>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Enter Room ID"
              className="w-full px-4 py-2 bg-gray-700 rounded mb-4 text-white"
            />
            <button
              onClick={handleJoinRoom}
              className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium"
            >
              Join Room
            </button>
          </div>
        </div>
      ) : (
        <div className="h-screen flex flex-col">
          <div className="flex-1 relative">
            <div className="absolute inset-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              <div className="relative bg-gray-800 rounded-lg overflow-hidden">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-75 px-2 py-1 rounded">
                  You
                </div>
              </div>
              {peers.map((peer) => (
                <div key={peer.id} className="relative bg-gray-800 rounded-lg overflow-hidden">
                  {peer.videoStream && (
                    <video
                      ref={setPeerVideoRef(peer.id)}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  )}
                  {peer.audioStream && (
                    <audio
                      ref={setPeerAudioRef(peer.id)}
                      autoPlay
                      playsInline
                    />
                  )}
                  <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-75 px-2 py-1 rounded">
                    Peer {peer.id.slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="h-20 bg-gray-800 flex items-center justify-center gap-4 px-4">
            <button
              onClick={toggleMute}
              className={cn(
                "p-4 rounded-full",
                isMuted ? "bg-red-600" : "bg-gray-700 hover:bg-gray-600"
              )}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>

            <button
              onClick={toggleVideo}
              className={cn(
                "p-4 rounded-full",
                isVideoOff ? "bg-red-600" : "bg-gray-700 hover:bg-gray-600"
              )}
            >
              {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
            </button>

            <div className="px-4 py-2 bg-gray-700 rounded-full flex items-center gap-2">
              <Users size={20} />
              <span>{peers.length + 1}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
