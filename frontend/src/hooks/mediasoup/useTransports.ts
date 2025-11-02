import { useEffect, useState } from 'react';
import { Device, types } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

export const useTransports = (device: Device | null, socket: Socket | null) => {
  const [producerTransport, setProducerTransport] = useState<types.Transport | null>(null);
  const [consumerTransport, setConsumerTransport] = useState<types.Transport | null>(null);

  useEffect(() => {
    if (!device || !socket) return;

    const create = async () => {
      try {
        // Create producer transport
        const { params: producerParams } = await new Promise<any>((resolve) =>
          socket.emit('createWebRtcTransport', { sender: true }, resolve)
        );
        const newProducerTransport = device.createSendTransport(producerParams);

        newProducerTransport.on('connect', ({ dtlsParameters }, callback) => {
          socket.emit('connectTransport', { dtlsParameters, sender: true });
          callback();
        });

        newProducerTransport.on('produce', async (parameters, callback) => {
          const { producerId } = await new Promise<any>((resolve) =>
            socket.emit('produce', parameters, resolve)
          );
          callback({ id: producerId });
        });

        setProducerTransport(newProducerTransport);

        // Create consumer transport
        const { params: consumerParams } = await new Promise<any>((resolve) =>
          socket.emit('createWebRtcTransport', { sender: false }, resolve)
        );
        const newConsumerTransport = device.createRecvTransport(consumerParams);

        newConsumerTransport.on('connect', ({ dtlsParameters }, callback) => {
          socket.emit('connectTransport', { dtlsParameters, sender: false });
          callback();
        });

        setConsumerTransport(newConsumerTransport);
        console.log('Transports created');

      } catch (error) {
        console.error('Failed to create transports:', error);
      }
    };

    create();

  }, [device, socket]);

  return { producerTransport, consumerTransport };
};
