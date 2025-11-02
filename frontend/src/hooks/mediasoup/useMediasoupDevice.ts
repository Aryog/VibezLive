import { useEffect, useState } from 'react';
import { Device } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

export const useMediasoupDevice = (socket: Socket | null) => {
  const [device, setDevice] = useState<Device | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleRouterCapabilities = async ({ routerRtpCapabilities }: any) => {
      try {
        const newDevice = new Device();
        await newDevice.load({ routerRtpCapabilities });
        setDevice(newDevice);
        console.log('Mediasoup device loaded');
      } catch (error) {
        console.error('Failed to load mediasoup device:', error);
      }
    };

    socket.on('routerCapabilities', handleRouterCapabilities);

    return () => {
      socket.off('routerCapabilities', handleRouterCapabilities);
    };
  }, [socket]);

  return device;
};
