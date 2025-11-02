import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Device, types } from 'mediasoup-client';
import { Socket } from 'socket.io-client';
import { Peer } from './types';

export const useConsumers = (device: Device | null, socket: Socket | null, consumerTransport: types.Transport | null) => {
  const [peers, setPeers] = useState<Peer[]>([]);
  const consumersRef = useRef<Map<string, types.Consumer>>(new Map());
  const producerQueue = useRef<any[]>([]);

  const setupConsumer = useCallback(async (producerId: string, peerId: string, appData: any) => {
    if (!device || !consumerTransport || !socket) {
      console.log('setupConsumer returned early: device, transport, or socket not ready');
      return;
    }

    try {
      const { params } = await new Promise<any>((resolve) =>
        socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, resolve)
      );

      if (params.error) {
        console.error('Error consuming stream:', params.error);
        return;
      }

      const consumer = await consumerTransport.consume(params);
      consumersRef.current.set(consumer.id, consumer);
      
      // Store mapping of producerId to consumerId for cleanup
      consumer.appData = { ...consumer.appData, producerId, peerId, mediaType: appData?.mediaType };

      const { track } = consumer;
      const stream = new MediaStream([track]);

      setPeers(prevPeers => {
        const existingPeer = prevPeers.find(p => p.id === peerId);
        if (existingPeer) {
          return prevPeers.map(p => {
            if (p.id === peerId) {
              if (consumer.kind === 'video') {
                return { ...p, [appData.mediaType === 'screen' ? 'screenStream' : 'videoStream']: stream };
              } else {
                return { ...p, audioStream: stream };
              }
            }
            return p;
          });
        } else {
          const newPeer: Peer = { id: peerId, audioRef: React.createRef() };
          if (consumer.kind === 'video') {
            newPeer[appData.mediaType === 'screen' ? 'screenStream' : 'videoStream'] = stream;
          } else {
            newPeer.audioStream = stream;
          }
          return [...prevPeers, newPeer];
        }
      });

      socket.emit('resumeConsumer', { consumerId: consumer.id });
      console.log(`Consumer created for peer ${peerId} for kind ${consumer.kind}`);

    } catch (error) {
      console.error('Failed to setup consumer:', error);
    }
  }, [device, consumerTransport, socket]);

  // Effect to process the queue when the transport is ready
  useEffect(() => {
    if (consumerTransport && producerQueue.current.length > 0) {
      console.log(`Consumer transport ready. Processing ${producerQueue.current.length} items from queue.`);
      producerQueue.current.forEach(item => setupConsumer(item.producerId, item.peerId, item.appData));
      producerQueue.current = []; // Clear the queue
    }
  }, [consumerTransport, setupConsumer]); // Re-run when transport becomes available

  // Effect to set up socket listeners. This should only run once.
  useEffect(() => {
    if (!socket) return;

    const handleNewProducer = (data: any) => {
      console.log('Received newProducer event.');
      if (consumerTransport) {
        setupConsumer(data.producerId, data.peerId, data.appData);
      } else {
        producerQueue.current.push(data);
      }
    };

    const handlePeerLeft = ({ peerId }: any) => {
      setPeers(prev => prev.filter(p => p.id !== peerId));
      console.log(`Peer ${peerId} left`);
    };

    const handleProducerClosed = ({ consumerId, producerId }: any) => {
      console.log(`Producer closed: ${producerId}, consumer: ${consumerId}`);
      
      // Find and close the consumer
      const consumer = consumersRef.current.get(consumerId);
      if (consumer) {
        const peerId = consumer.appData.peerId;
        const mediaType = consumer.appData.mediaType;
        
        // Close and remove the consumer
        consumer.close();
        consumersRef.current.delete(consumerId);
        
        // Update peer state to remove the specific stream
        setPeers(prevPeers => {
          return prevPeers.map(p => {
            if (p.id === peerId) {
              const updatedPeer = { ...p };
              if (mediaType === 'screen') {
                delete updatedPeer.screenStream;
              } else if (consumer.kind === 'video') {
                delete updatedPeer.videoStream;
              } else if (consumer.kind === 'audio') {
                delete updatedPeer.audioStream;
              }
              return updatedPeer;
            }
            return p;
          });
        });
        
        console.log(`Removed ${mediaType || consumer.kind} stream for peer ${peerId}`);
      }
    };

    const handleCurrentProducers = ({ producers }: any) => {
      console.log(`Received currentProducers event with ${producers.length} producers.`);
      if (consumerTransport) {
        for (const producer of producers) {
          setupConsumer(producer.producerId, producer.peerId, producer.appData);
        }
      } else {
        producerQueue.current = producers;
      }
    };

    socket.on('currentProducers', handleCurrentProducers);
    socket.on('newProducer', handleNewProducer);
    socket.on('peerLeft', handlePeerLeft);
    socket.on('producerClosed', handleProducerClosed);

    return () => {
      socket.off('currentProducers', handleCurrentProducers);
      socket.off('newProducer', handleNewProducer);
      socket.off('peerLeft', handlePeerLeft);
      socket.off('producerClosed', handleProducerClosed);
    };
  }, [socket, setupConsumer]);

  return peers;
};
