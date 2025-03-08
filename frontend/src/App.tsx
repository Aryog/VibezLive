import { useEffect, useRef, useState } from 'react';
import { Socket, io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { Video, Mic, MicOff, VideoOff, Users, Monitor, MonitorOff } from 'lucide-react';
import { cn } from './lib/utils';

const SERVER_URL = 'http://localhost:3000';

interface Peer {
  id: string;
  videoStream?: MediaStream;
  audioStream?: MediaStream;
  screenStream?: MediaStream;
}

function App() {
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [transportReady, setTransportReady] = useState(false);
  const [localVideoLoading, setLocalVideoLoading] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const producerTransportRef = useRef<any>(null);
  const consumerTransportRef = useRef<any>(null);
  const videoProducerRef = useRef<any>(null);
  const audioProducerRef = useRef<any>(null);
  const consumersRef = useRef<Map<string, any>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const peerVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  const peerAudioRefs = useRef<Map<string, HTMLAudioElement | null>>(new Map());
  const pendingConsumersRef = useRef<string[]>([]);
  const producerToPeerMapRef = useRef<Map<string, string>>(new Map());
  const screenProducerRef = useRef<any>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Add this function to check if we're ready for media
  const isReadyForMedia = () => {
    return deviceLoaded && 
           transportReady && 
           consumerTransportRef.current && 
           socketRef.current?.connected;
  };

  // Add this function to synchronize states
  const syncMediaStates = () => {
    if (deviceRef.current?.loaded && !deviceLoaded) {
      console.log('Syncing device loaded state to true');
      setDeviceLoaded(true);
    }
    
    if (consumerTransportRef.current && producerTransportRef.current && !transportReady) {
      console.log('Syncing transport ready state to true');
      setTransportReady(true);
    }
  };

  // Update the setupConsumer function to use this check
  const setupConsumer = async (producerId: string) => {
    try {
      // Add a delay to ensure the device and transport are truly ready
      if (!isReadyForMedia()) {
        console.log('Device or transport not ready yet, adding to pending consumers queue', {
          deviceLoaded,
          transportReady,
          hasConsumerTransport: !!consumerTransportRef.current,
          socketConnected: socketRef.current?.connected
        });
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

      // Get the actual peer ID from our map
      const actualPeerId = producerToPeerMapRef.current.get(params.peerId) || params.peerId;

      console.log('Setting up consumer for producer:', {
        producerId,
        consumerId: params.id,
        peerId: actualPeerId,
        kind: params.kind
      });

      const consumer = await consumerTransportRef.current.consume({
        ...params,
        peerId: actualPeerId // Use the actual peer ID
      });
      
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
        const peer = prevPeers.find(p => p.id === actualPeerId);
        console.log('Updating peers state:', {
          peerId: actualPeerId,
          consumerKind: consumer.kind,
          existingPeer: !!peer,
          isScreenShare: consumer.appData?.mediaType === 'screen',
          currentPeers: prevPeers.map(p => ({ id: p.id, hasVideo: !!p.videoStream, hasAudio: !!p.audioStream }))
        });

        if (peer) {
          if (consumer.kind === 'video') {
            if (consumer.appData?.mediaType === 'screen') {
              peer.screenStream = stream;
            } else {
              peer.videoStream = stream;
            }
          } else {
            peer.audioStream = stream;
          }
          return [...prevPeers];
        }
        return [...prevPeers, { 
          id: actualPeerId,
          [consumer.kind === 'video' ? 
            (consumer.appData?.mediaType === 'screen' ? 'screenStream' : 'videoStream') 
            : 'audioStream']: stream 
        }];
      });

      await socketRef.current?.emit('resumeConsumer', { consumerId: consumer.id });
    } catch (error) {
      console.error('Error setting up consumer:', error);
      throw error; // Rethrow for retry mechanism
    }
  };

  // Modify processPendingConsumers to be more robust
  const processPendingConsumers = async () => {
    if (isReadyForMedia() && pendingConsumersRef.current.length > 0) {
      console.log(`Processing ${pendingConsumersRef.current.length} pending consumers`);
      const consumers = [...pendingConsumersRef.current];
      pendingConsumersRef.current = [];

      // Add a larger delay to ensure everything is properly initialized
      await new Promise(resolve => setTimeout(resolve, 1000));

      for (const producerId of consumers) {
        try {
          await setupConsumer(producerId);
        } catch (error) {
          console.error(`Failed to process pending consumer ${producerId}:`, error);
        }
      }
    } else if (pendingConsumersRef.current.length > 0) {
      console.log('Have pending consumers but not ready for media yet', {
        deviceLoaded,
        transportReady,
        hasConsumerTransport: !!consumerTransportRef.current,
        socketConnected: socketRef.current?.connected,
        pendingCount: pendingConsumersRef.current.length
      });
    }
  };

  const removeConsumer = (consumerId: string) => {
    const consumer = consumersRef.current.get(consumerId);
    if (consumer) {
      consumer.close();
      consumersRef.current.delete(consumerId);
    }
  };

  // Set video and audio srcObject imperatively with retry mechanism
  useEffect(() => {
    // Set local video with retry mechanism
    if (localVideoRef.current && streamRef.current) {
      const attemptAttachStream = (attempts = 0) => {
        try {
          localVideoRef.current!.srcObject = streamRef.current;
          console.log('Successfully attached local stream to video element');
          setLocalVideoLoading(false);
        } catch (error) {
          console.error('Error attaching stream to video:', error);
          if (attempts < 5) {
            setTimeout(() => attemptAttachStream(attempts + 1), 300);
          } else {
            setLocalVideoLoading(false);
          }
        }
      };
      
      attemptAttachStream();
    }

    // Update refs for peer media elements with retry
    peers.forEach(peer => {
      const videoRef = peerVideoRefs.current.get(peer.id);
      if (videoRef && peer.videoStream) {
        if (videoRef.srcObject !== peer.videoStream) {
          videoRef.srcObject = peer.videoStream;
        }
      }

      const audioRef = peerAudioRefs.current.get(peer.id);
      if (audioRef && peer.audioStream) {
        if (audioRef.srcObject !== peer.audioStream) {
          audioRef.srcObject = peer.audioStream;
        }
      }
    });
  }, [peers, streamRef.current]);

  // Make sure both useEffect hooks are robust
  useEffect(() => {
    // Process pending consumers when device is loaded and transport is ready
    if (deviceLoaded && transportReady) {
      console.log('Device and transport are ready, checking for pending consumers');
      setTimeout(() => {
        processPendingConsumers();
      }, 1000); // Add delay to ensure everything is properly initialized
    }
  }, [deviceLoaded, transportReady]);

  // Add a more aggressive periodic check
  useEffect(() => {
    if (isConnected) {
      const intervalId = setInterval(() => {
        // Sync states on every interval
        syncMediaStates();
        
        if (pendingConsumersRef.current.length > 0) {
          console.log('Periodic check for pending consumers', {
            deviceLoaded,
            transportReady,
            hasConsumerTransport: !!consumerTransportRef.current,
            socketConnected: socketRef.current?.connected,
            isReady: isReadyForMedia(),
            pendingCount: pendingConsumersRef.current.length
          });
          
          if (isReadyForMedia()) {
            console.log('Periodic check found pending consumers to process');
            processPendingConsumers();
          } else if (deviceRef.current?.loaded && consumerTransportRef.current) {
            // Force process anyway if we detect the actual device and transport are ready
            console.log('Forcing processing of pending consumers');
            setDeviceLoaded(true);
            setTransportReady(true);
            setTimeout(() => processPendingConsumers(), 500);
          }
        }
      }, 2000); // Check every 2 seconds

      return () => clearInterval(intervalId);
    }
  }, [isConnected, deviceLoaded, transportReady]);

  // Setup socket connection
  useEffect(() => {
    // Only create socket if it doesn't exist
    if (!socketRef.current) {
      socketRef.current = io(SERVER_URL, {
        // Add these options to prevent multiple connections
        reconnection: true,
        reconnectionAttempts: 5,
        transports: ['websocket']
      });

      socketRef.current.on('connect', () => {
        console.log('Connected to server with ID:', socketRef.current?.id);
      });

      socketRef.current.on('routerCapabilities', async ({ routerRtpCapabilities }) => {
        try {
          console.log('Received router capabilities, loading device');
          deviceRef.current = new Device();

          await deviceRef.current.load({ routerRtpCapabilities });
          setDeviceLoaded(true);
          console.log('Device loaded successfully');

          await createTransports();
        } catch (error) {
          console.error('Failed to load device:', error);
        }
      });

      socketRef.current.on('newProducer', async ({ producerId, peerId, kind, appData }) => {
        console.log(`New ${kind} producer from peer ${peerId}, producerId: ${producerId}, type: ${appData?.mediaType || 'camera'}`);
        
        // Sync states immediately when we receive a new producer
        syncMediaStates();
        
        // Store the mapping when we receive a new producer
        producerToPeerMapRef.current.set(producerId, peerId);
        
        // Also store the type of producer (screen or camera)
        if (appData?.mediaType === 'screen') {
          console.log(`This is a screen share from peer ${peerId}`);
        }
        
        // Retry setup consumer with delays and state syncing
        let attempts = 0;
        const maxAttempts = 8; // Increase max attempts
        const setupWithRetry = async () => {
          try {
            // Sync states again before each attempt
            syncMediaStates();
            
            if (isReadyForMedia()) {
              await setupConsumer(producerId);
            } else {
              console.log('Still not ready for media on attempt', attempts, {
                deviceLoaded,
                transportReady,
                hasConsumerTransport: !!consumerTransportRef.current,
                socketConnected: socketRef.current?.connected
              });
              
              if (attempts < maxAttempts) {
                attempts++;
                setTimeout(setupWithRetry, 1000); // Consistent delay
              } else {
                // After max attempts, try forcing the consumer setup anyway
                console.log('Forcing consumer setup after max retries');
                await setupConsumer(producerId);
              }
            }
          } catch (error) {
            console.error(`Failed to setup consumer on attempt ${attempts + 1}:`, error);
            if (attempts < maxAttempts) {
              attempts++;
              setTimeout(setupWithRetry, 1000);
            }
          }
        };
        
        setupWithRetry();
      });

      socketRef.current.on('newPeer', ({ peerId }) => {
        setPeers(prev => [...prev, { id: peerId }]);
      });

      socketRef.current.on('peerLeft', ({ peerId }) => {
        console.log(`Peer ${peerId} left the room`);
        setPeers(prev => prev.filter(p => p.id !== peerId));
      });

      socketRef.current.on('currentProducers', ({ producers }) => {
        console.log(`Received ${producers.length} current producers`);

        for (const { producerId, peerId, kind } of producers) {
          if (!pendingConsumersRef.current.includes(producerId)) {
            console.log(`Processing producer: ${kind} from peer ${peerId}`);
            // Store the producer-to-peer mapping
            if (deviceLoaded && transportReady && consumerTransportRef.current) {
              setupConsumer(producerId);
            } else {
              pendingConsumersRef.current.push(producerId);
              console.log(`Queued producer ${producerId} (${kind}) from peer ${peerId} to be consumed later`);
            }
          }
        }
      });
    }

    return () => {
      if (socketRef.current) {
        console.log('Disconnecting socket:', socketRef.current.id);
        socketRef.current.disconnect();
        socketRef.current = null;  // Clear the ref
      }
      streamRef.current?.getTracks().forEach(track => track.stop());

      if (producerTransportRef.current) {
        producerTransportRef.current.close();
      }

      if (consumerTransportRef.current) {
        consumerTransportRef.current.close();
      }
    };
  }, []); // Empty dependency array since we only want this to run once

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

      consumerTransportRef.current.on('connect', ({ dtlsParameters }: { dtlsParameters: any }, callback: () => void) => {
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

      producerTransportRef.current.on('connect', ({ dtlsParameters }: { dtlsParameters: any }, callback: () => void) => {
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

      // Mark transports as ready and sync device loaded state too
      setDeviceLoaded(true);
      setTransportReady(true);
      console.log('Transports created successfully and states synchronized');

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
        console.log('Video producer created:', {
          producerId: videoProducerRef.current.id,
          kind: 'video',
          peerId: socketRef.current?.id
        });
      }

      // Publish audio
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioProducerRef.current = await producerTransportRef.current.produce({
          track: audioTrack
        });
        console.log('Audio producer created:', {
          producerId: audioProducerRef.current.id,
          kind: 'audio',
          peerId: socketRef.current?.id
        });
      }
    } catch (error) {
      console.error('Failed to publish stream:', error);
    }
  };

  const handleJoinRoom = async () => {
    if (!roomId) return;

    try {
      console.log('Joining room:', roomId);
      setLocalVideoLoading(true);

      // Get user media first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      streamRef.current = stream;

      // Set local video stream with a small delay to ensure browser is ready
      setTimeout(() => {
        if (localVideoRef.current) {
          try {
            localVideoRef.current.srcObject = stream;
            console.log('Local video stream set successfully');
          } catch (error) {
            console.error('Error setting local video stream:', error);
          }
        }
      }, 500);

      // Join room on server
      socketRef.current?.emit('joinRoom', { roomId });
      setIsConnected(true);

      // If device is already loaded, publish the stream with a small delay
      if (deviceLoaded && transportReady && producerTransportRef.current) {
        setTimeout(async () => {
          await publishStream();
        }, 800);
      }
    } catch (error) {
      console.error('Error joining room:', error);
      setLocalVideoLoading(false);
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

  // Add this function to toggle screen sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen sharing
      if (screenProducerRef.current) {
        screenProducerRef.current.close();
        screenProducerRef.current = null;
      }
      
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      setIsScreenSharing(false);
    } else {
      try {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true // Enable audio sharing if possible
        });
        
        screenStreamRef.current = screenStream;
        
        // Handle when user stops sharing via the browser UI
        screenStream.getVideoTracks()[0].onended = () => {
          if (screenProducerRef.current) {
            screenProducerRef.current.close();
            screenProducerRef.current = null;
          }
          setIsScreenSharing(false);
        };
        
        // Make sure transports are ready
        if (!producerTransportRef.current || !deviceRef.current || !deviceRef.current.loaded) {
          console.warn('Transports not ready for screen sharing');
          return;
        }
        
        // Create a screen share producer
        const screenTrack = screenStream.getVideoTracks()[0];
        screenProducerRef.current = await producerTransportRef.current.produce({
          track: screenTrack,
          encodings: [
            { maxBitrate: 500000 },
            { maxBitrate: 1000000 },
            { maxBitrate: 5000000 }
          ],
          codecOptions: {
            videoGoogleStartBitrate: 1000
          },
          appData: {
            mediaType: 'screen' // Add metadata to identify this as a screen share
          }
        });
        
        console.log('Screen share producer created:', {
          producerId: screenProducerRef.current.id,
          kind: 'video',
          mediaType: 'screen',
          peerId: socketRef.current?.id
        });
        
        setIsScreenSharing(true);
      } catch (error) {
        console.error('Error starting screen share:', error);
      }
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
                {localVideoLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-70">
                    <div className="text-white">Loading video...</div>
                  </div>
                )}
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

            <button
              onClick={toggleScreenShare}
              className={cn(
                "p-4 rounded-full",
                isScreenSharing ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
              )}
            >
              {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
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
