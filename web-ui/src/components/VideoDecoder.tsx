import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';

export interface VideoDecoderHandle {
  decodeChunk: (data: ArrayBuffer) => void;
}

const VideoDecoder = forwardRef<VideoDecoderHandle, { className?: string }>(
  ({ className }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const decoderRef = useRef<VideoDecoder | null>(null);
    const initRef = useRef(false);

    useImperativeHandle(ref, () => ({
      decodeChunk: (data: ArrayBuffer) => {
        if (!decoderRef.current) return;
        const chunk = new EncodedVideoChunk({
          type: 'key',
          timestamp: performance.now(),
          data,
        });
        decoderRef.current.decode(chunk);
      },
    }));

    useEffect(() => {
      if (initRef.current) return;
      if (!('VideoDecoder' in window)) {
        console.error('[VideoDecoder] WebCodecs API not supported');
        return;
      }

      const decoder = new window.VideoDecoder({
        output: (frame: VideoFrame) => {
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = frame.displayWidth;
              canvas.height = frame.displayHeight;
              ctx.drawImage(frame, 0, 0);
            }
          }
          frame.close();
        },
        error: (e: Error) => {
          console.error('[VideoDecoder] decode error:', e);
        },
      });

      decoder.configure({
        codec: 'avc1.640028',
        hardwareAcceleration: 'prefer-hardware',
      } as VideoDecoderConfig);

      decoderRef.current = decoder;
      initRef.current = true;

      return () => {
        decoder.close();
        decoderRef.current = null;
        initRef.current = false;
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ imageRendering: 'auto', maxWidth: '100%', maxHeight: '100%' }}
      />
    );
  }
);

VideoDecoder.displayName = 'VideoDecoder';
export default VideoDecoder;
