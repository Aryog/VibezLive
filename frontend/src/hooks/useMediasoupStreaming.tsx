import { useEffect, useRef, useState } from 'react';
import { Socket, io } from 'socket.io-client';
import { Device } from 'mediasoup-client';

const SERVER_URL = 'http://localhost:3000';

export interface Peer {
  id: string;
  videoStream?: MediaStream;
  audioStream?: MediaStream;
  screenStream?: MediaStream;
}

export function useMediasoupStreaming() {
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

  // Check if we're ready for media
  const isReadyForMedia = () => {
    return deviceLoaded && 
           transportReady && 
           consumerTransportRef.current && 
           socketRef.current?.connected;
  };

  // Synchronize states
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

  // Setup consumer with retry mechanism
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
      
      // Check if we have stored a type for this producer
      const streamType = producerToPeerMapRef.current.get(`${producerId}_type`) || 
                        (consumer.appData?.mediaType === 'screen' ? 'screen' : 'camera');
      
      console.log(`Setting up ${streamType} consumer for producer ${producerId} from peer ${actualPeerId}`);

      // Create a new MediaStream for this consumer
      const stream = new MediaStream([track]);

      // Update peers state with the new stream
      setPeers(prevPeers => {
        // Make a copy of the peers array
        const peersCopy = [...prevPeers];
        
        // Find the peer if it exists
        const peerIndex = peersCopy.findIndex(p => p.id === actualPeerId);
        
        console.log('Setting up consumer:', {
          peerId: actualPeerId,
          consumerKind: consumer.kind,
          existingPeer: peerIndex !== -1,
          streamType,
          isScreenShare: streamType === 'screen' || consumer.appData?.mediaType === 'screen',
          currentPeers: peersCopy.map(p => ({ 
            id: p.id, 
            hasVideo: !!p.videoStream, 
            hasAudio: !!p.audioStream, 
            hasScreen: !!p.screenStream 
          }))
        });

        if (peerIndex !== -1) {
          // Peer exists, update the specific stream based on type
          if (consumer.kind === 'video') {
            if (streamType === 'screen' || consumer.appData?.mediaType === 'screen') {
              // This is a screen share
              peersCopy[peerIndex] = {
                ...peersCopy[peerIndex],
                screenStream: stream
              };
              console.log(`Set screen stream for peer ${actualPeerId}`);
            } else {
              // This is a webcam video
              peersCopy[peerIndex] = {
                ...peersCopy[peerIndex],
                videoStream: stream
              };
              console.log(`Set webcam video stream for peer ${actualPeerId}`);
            }
          } else if (consumer.kind === 'audio') {
            peersCopy[peerIndex] = {
              ...peersCopy[peerIndex],
              audioStream: stream
            };
          }
        } else {
          // Peer doesn't exist, create a new entry
          const newPeer: Peer = { id: actualPeerId };
          
          if (consumer.kind === 'video') {
            if (streamType === 'screen' || consumer.appData?.mediaType === 'screen') {
              newPeer.screenStream = stream;
              console.log(`Created new peer with screen stream: ${actualPeerId}`);
            } else {
              newPeer.videoStream = stream;
              console.log(`Created new peer with webcam stream: ${actualPeerId}`);
            }
          } else if (consumer.kind === 'audio') {
            newPeer.audioStream = stream;
          }
          
          peersCopy.push(newPeer);
        }
        
        return peersCopy;
      });

      await socketRef.current?.emit('resumeConsumer', { consumerId: consumer.id });
    } catch (error) {
      console.error('Error setting up consumer:', error);
      throw error; // Rethrow for retry mechanism
    }
  };

  // Process pending consumers
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

  // Remove a consumer
  const removeConsumer = (consumerId: string) => {
    const consumer = consumersRef.current.get(consumerId);
    if (consumer) {
      consumer.close();
      consumersRef.current.delete(consumerId);
    }
  };

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

  // Publish webcam and microphone streams
  const publishStream = async () => {
    try {
      if (!streamRef.current || !producerTransportRef.current) {
        console.warn('Stream or producer transport not ready');
        return;
      }

      console.log('Publishing stream...');

      // Publish video
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack && !videoProducerRef.current) {
        try {
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
        } catch (error) {
          console.error('Error publishing video track:', error);
        }
      }

      // Publish audio
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack && !audioProducerRef.current) {
        try {
          audioProducerRef.current = await producerTransportRef.current.produce({
            track: audioTrack
          });
          console.log('Audio producer created:', {
            producerId: audioProducerRef.current.id,
            kind: 'audio',
            peerId: socketRef.current?.id
          });
        } catch (error) {
          console.error('Error publishing audio track:', error);
        }
      }
    } catch (error) {
      console.error('Failed to publish stream:', error);
    }
  };

  // Republish webcam
  const republishWebcam = async () => {
    if (!streamRef.current || !producerTransportRef.current) return;
    
    try {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (!videoTrack) return;
      
      console.log('Republishing webcam video track');
      
      // Make sure track is enabled
      videoTrack.enabled = true;
      
      // If we already have a producer, just make sure track is enabled
      if (videoProducerRef.current) {
        console.log('Video producer already exists, ensuring track is enabled');
        return;
      }
      
      // Otherwise create a new producer with explicit appData
      videoProducerRef.current = await producerTransportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100000 },
          { maxBitrate: 300000 },
          { maxBitrate: 900000 }
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        },
        appData: {
          mediaType: 'camera' // Explicitly mark as camera
        }
      });
      
      // Store the producer type mapping
      producerToPeerMapRef.current.set(`${videoProducerRef.current.id}_type`, 'camera');
      
      console.log('Webcam video producer created/recreated:', {
        producerId: videoProducerRef.current.id,
        kind: 'video',
        mediaType: 'camera',
        peerId: socketRef.current?.id
      });
    } catch (error) {
      console.error('Error republishing webcam:', error);
    }
  };

  // Join a room
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

  // Toggle audio mute
  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      try {
        // Stop screen sharing
        if (screenProducerRef.current) {
          console.log('Closing screen share producer:', screenProducerRef.current.id);
          
          // Notify the server about closing this producer
          socketRef.current?.emit('closeProducer', { 
            producerId: screenProducerRef.current.id 
          });
          
          // Remove the type mapping
          producerToPeerMapRef.current.delete(`${screenProducerRef.current.id}_type`);
          
          screenProducerRef.current.close();
          screenProducerRef.current = null;
        }
        
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(track => track.stop());
          screenStreamRef.current = null;
        }
        
        setIsScreenSharing(false);
        
        // Important: Only adjust webcam video state based on the UI state, don't disable
        // the video track if it should be enabled according to the UI
        if (isVideoOff && streamRef.current) {
          const videoTracks = streamRef.current.getVideoTracks();
          videoTracks.forEach(track => {
            track.enabled = false;
          });
          console.log('Restored webcam video to disabled state after closing screen share');
        } else if (!isVideoOff && streamRef.current) {
          // Ensure video track is enabled if UI shows video is on
          const videoTracks = streamRef.current.getVideoTracks();
          videoTracks.forEach(track => {
            track.enabled = true;
          });
          console.log('Ensured webcam video remains enabled after closing screen share');
        }
      } catch (error) {
        console.error('Error stopping screen share:', error);
      }
    } else {
      try {
        // Start screen sharing with optimized constraints
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 30 },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
        
        screenStreamRef.current = screenStream;
        
        // Add optimization for the video track
        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack) {
          // Set content hint for better optimization
          videoTrack.contentHint = 'detail';
          
          // Set track settings for better performance
          try {
            await videoTrack.applyConstraints({
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { max: 30 }
            });
          } catch (error) {
            console.error('Error applying screen share constraints:', error);
          }
        }
        
        // Handle when user stops sharing via the browser UI
        screenStream.getVideoTracks()[0].onended = () => {
          if (screenProducerRef.current) {
            console.log('Screen share ended by browser UI, closing producer:', screenProducerRef.current.id);
            
            // Notify the server when the browser UI is used to stop sharing
            socketRef.current?.emit('closeProducer', { 
              producerId: screenProducerRef.current.id 
            });
            
            // Remove the type mapping
            producerToPeerMapRef.current.delete(`${screenProducerRef.current.id}_type`);
            
            screenProducerRef.current.close();
            screenProducerRef.current = null;
          }
          
          setIsScreenSharing(false);
          
          // Important: Only restore webcam state based on UI, don't disable
          // the webcam if it's supposed to be on
          if (isVideoOff && streamRef.current) {
            const videoTracks = streamRef.current.getVideoTracks();
            videoTracks.forEach(track => {
              track.enabled = false;
            });
            console.log('Restored webcam video to disabled state after screen share ended via browser UI');
          } else if (!isVideoOff && streamRef.current) {
            // Ensure video track is enabled if UI shows video is on
            const videoTracks = streamRef.current.getVideoTracks();
            videoTracks.forEach(track => {
              track.enabled = true;
            });
            console.log('Ensured webcam video remains enabled after screen share ended via browser UI');
          }
        };
        
        // Save the current webcam state for reference
        const wasVideoOff = isVideoOff;
        
        // Make sure transports are ready
        if (!producerTransportRef.current || !deviceRef.current || !deviceRef.current.loaded) {
          console.warn('Transports not ready for screen sharing');
          return;
        }
        
        // Ensure we have a webcam video producer first if not already created
        if (!videoProducerRef.current && streamRef.current) {
          await republishWebcam();
          console.log('Created webcam video producer before starting screen share');
        }
        
        // Create a screen share producer with explicit appData
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
        
        // Store the producer type mapping
        producerToPeerMapRef.current.set(`${screenProducerRef.current.id}_type`, 'screen');
        
        // Make sure webcam video track is enabled regardless of UI state
        // This allows both streams to be active simultaneously
        if (streamRef.current) {
          const videoTracks = streamRef.current.getVideoTracks();
          if (videoTracks && videoTracks.length > 0) {
            // Make sure the track is enabled, even if UI shows as disabled
            videoTracks.forEach(track => {
              if (!track.enabled) {
                track.enabled = true;
                console.log('Temporarily enabled webcam track for dual streaming');
              }
            });
          }
        }
        
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

  // Log detailed information about peer streams
  const logPeerStreamsInfo = () => {
    console.log('Current peers with stream details:', 
      peers.map(peer => ({
        id: peer.id,
        hasVideo: !!peer.videoStream,
        hasScreen: !!peer.screenStream,
        hasAudio: !!peer.audioStream,
        videoTracks: peer.videoStream?.getTracks().length || 0,
        screenTracks: peer.screenStream?.getTracks().length || 0,
        audioTracks: peer.audioStream?.getTracks().length || 0
      }))
    );
  };

  // Update the stream attachment effect to be more stable
  useEffect(() => {
    // Set local video with debounce and stability checks
    if (localVideoRef.current && streamRef.current) {
      const videoEl = localVideoRef.current;
      
      // Only update if necessary
      if (!videoEl.srcObject || videoEl.srcObject !== streamRef.current) {
        const attachStream = () => {
          try {
            if (!videoEl.srcObject || videoEl.srcObject !== streamRef.current) {
              videoEl.srcObject = streamRef.current;
              videoEl.muted = true; // Always mute local video
            }
            setLocalVideoLoading(false);
          } catch (error) {
            console.error('Error attaching local stream:', error);
            setLocalVideoLoading(false);
          }
        };
        
        // Use requestAnimationFrame for smoother updates
        requestAnimationFrame(attachStream);
      }
    }
  }, [streamRef.current]);

  // Separate effect for peer streams to avoid conflicts
  useEffect(() => {
    if (!peers.length) return;
    
    // Handle peer video streams
    requestAnimationFrame(() => {
      const videoRefEntries = Array.from(peerVideoRefs.current.entries());
      
      for (const [peerId, videoRef] of videoRefEntries) {
        const peer = peers.find(p => p.id === peerId);
        
        if (videoRef && peer?.videoStream && videoRef.srcObject !== peer.videoStream) {
          try {
            videoRef.srcObject = peer.videoStream;
          } catch (error) {
            console.error('Error attaching peer video stream:', error);
          }
        }
      }
    });
    
    // Handle peer audio streams
    requestAnimationFrame(() => {
      const audioRefEntries = Array.from(peerAudioRefs.current.entries());
      
      for (const [peerId, audioRef] of audioRefEntries) {
        const peer = peers.find(p => p.id === peerId);
        
        if (audioRef && peer?.audioStream && audioRef.srcObject !== peer.audioStream) {
          try {
            audioRef.srcObject = peer.audioStream;
          } catch (error) {
            console.error('Error attaching peer audio stream:', error);
          }
        }
      }
    });
  }, [peers]);

  // Process pending consumers when device is loaded and transport is ready
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
        
        // Store additional information about the producer type
        if (kind === 'video') {
          const streamType = appData?.mediaType === 'screen' ? 'screen' : 'camera';
          console.log(`Identified video producer ${producerId} as ${streamType} from peer ${peerId}`);
          // Track this producer's type for future reference
          producerToPeerMapRef.current.set(`${producerId}_type`, streamType);
        }
        
        // Retry setup consumer with delays and state syncing
        let attempts = 0;
        const maxAttempts = 8;
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
                setTimeout(setupWithRetry, 1000);
              } else {
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

      socketRef.current.on('producerClosed', ({ producerId }) => {
        console.log(`Producer ${producerId} was closed by its owner`);
        
        // Find which peer this producer belongs to
        const peerId = producerToPeerMapRef.current.get(producerId);
        if (!peerId) {
          console.log(`No peer found for producer ${producerId}`);
          return;
        }
        
        // Get the producer type to determine which stream to remove
        const producerType = producerToPeerMapRef.current.get(`${producerId}_type`);
        console.log(`Producer ${producerId} of type ${producerType || 'unknown'} from peer ${peerId} was closed`);
        
        // Update the peers state to remove the appropriate stream
        setPeers(prevPeers => {
          // Find the consumer for this producer to determine what type it is
          const matchingConsumers = Array.from(consumersRef.current.entries())
            .filter(([_, consumer]) => consumer.producerId === producerId);
          
          if (matchingConsumers.length > 0) {
            const [consumerId, consumer] = matchingConsumers[0];
            
            // Make a copy of the peers array
            const updatedPeers = [...prevPeers];
            
            // Find the peer to update
            const peerIndex = updatedPeers.findIndex(p => p.id === peerId);
            if (peerIndex !== -1) {
              // Determine which stream to remove based on producer type
              const isScreenShare = producerType === 'screen' || consumer.appData?.mediaType === 'screen';
              
              if (isScreenShare) {
                console.log(`Removing screen stream for peer ${peerId}`);
                // This was a screen share, so remove only the screen stream
                updatedPeers[peerIndex] = {
                  ...updatedPeers[peerIndex],
                  screenStream: undefined
                };
              } else if (consumer.kind === 'video') {
                // Regular video stream
                console.log(`Removing webcam video stream for peer ${peerId}`);
                updatedPeers[peerIndex] = {
                  ...updatedPeers[peerIndex],
                  videoStream: undefined
                };
              } else if (consumer.kind === 'audio') {
                // Audio stream
                console.log(`Removing audio stream for peer ${peerId}`);
                updatedPeers[peerIndex] = {
                  ...updatedPeers[peerIndex],
                  audioStream: undefined
                };
              }
            }
            
            // Also close and remove the consumer
            consumer.close();
            consumersRef.current.delete(consumerId);
            
            return updatedPeers;
          }
          
          // If we couldn't find the consumer, just return the current state
          return prevPeers;
        });
        
        // Clean up the producer mapping
        producerToPeerMapRef.current.delete(producerId);
        producerToPeerMapRef.current.delete(`${producerId}_type`);
      });

      socketRef.current.on('requestSync', async () => {
        console.log('Received sync request, republishing streams if needed');
        
        // If we have webcam video stream, make sure it's being published
        if (streamRef.current) {
          await republishWebcam();
        }
        
        // If screen sharing is active, ensure it's properly published
        if (isScreenSharing && screenStreamRef.current && !screenProducerRef.current) {
          try {
            const screenTrack = screenStreamRef.current.getVideoTracks()[0];
            if (screenTrack) {
              console.log('Re-publishing screen share after sync request');
              
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
                  mediaType: 'screen'
                }
              });
            }
          } catch (error) {
            console.error('Error republishing screen share:', error);
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

  // Monitor for stream issues
  useEffect(() => {
    if (isConnected) {
      const intervalId = setInterval(() => {
        // Check if we have any peers that should have video but don't
        const missingStreams = peers.filter(peer => 
          peer.screenStream && !peer.videoStream && 
          !producerToPeerMapRef.current.has(peer.id + '_video_missing')
        );
        
        if (missingStreams.length > 0) {
          console.log('Found peers with screen shares but missing video streams:', 
            missingStreams.map(p => p.id));
          
          // Mark these peers so we don't log repeatedly
          missingStreams.forEach(peer => {
            producerToPeerMapRef.current.set(peer.id + '_video_missing', 'checked');
            
            // Trigger a sync for this peer's streams if possible
            if (socketRef.current) {
              console.log(`Requesting sync for peer ${peer.id}`);
              socketRef.current.emit('requestSync', { peerId: peer.id });
            }
          });
          
          // Log detailed information about all peers
          logPeerStreamsInfo();
        }
      }, 5000); // Check every 5 seconds
      
      return () => clearInterval(intervalId);
    }
  }, [isConnected, peers]);

  // Add this new effect specifically for screen share stream handling
  useEffect(() => {
    if (!isScreenSharing || !screenStreamRef.current) return;
    
    // Configure screen share stream for optimal performance
    const screenTrack = screenStreamRef.current.getVideoTracks()[0];
    if (screenTrack) {
      try {
        // Set optimal video constraints for screen sharing
        screenTrack.applyConstraints({
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { max: 30 } // Limit frame rate to reduce processing load
        });
      } catch (error) {
        console.error('Error optimizing screen share track:', error);
      }
    }
  }, [isScreenSharing, screenStreamRef.current]);

  return {
    // State variables
    roomId,
    setRoomId,
    isConnected,
    isMuted,
    isVideoOff,
    peers,
    deviceLoaded,
    transportReady,
    localVideoLoading,
    isScreenSharing,
    
    // Refs
    localVideoRef,
    streamRef,
    screenStreamRef,
    
    // Functions
    handleJoinRoom,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    setPeerVideoRef,
    setPeerAudioRef,
  };
}