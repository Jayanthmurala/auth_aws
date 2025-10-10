import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createGzip, createDeflate, createBrotliCompress } from 'zlib';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { Logger } from '../utils/logger';

/**
 * Advanced compression middleware for bandwidth optimization
 * Supports gzip, deflate, and brotli compression with intelligent selection
 */

export interface CompressionConfig {
  threshold: number;           // Minimum response size to compress (bytes)
  level: number;              // Compression level (1-9)
  chunkSize: number;          // Chunk size for streaming
  enableBrotli: boolean;      // Enable brotli compression
  mimeTypes: string[];        // MIME types to compress
  excludeExtensions: string[]; // File extensions to exclude
}

const DEFAULT_CONFIG: CompressionConfig = {
  threshold: 1024,            // 1KB minimum
  level: 6,                   // Balanced compression
  chunkSize: 16384,           // 16KB chunks
  enableBrotli: true,
  mimeTypes: [
    'text/plain',
    'text/html',
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/json',
    'application/xml',
    'text/xml',
    'application/rss+xml',
    'application/atom+xml',
    'image/svg+xml'
  ],
  excludeExtensions: [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif',
    '.mp4', '.avi', '.mov', '.wmv',
    '.mp3', '.wav', '.ogg',
    '.zip', '.rar', '.7z', '.tar', '.gz'
  ]
};

/**
 * Compression algorithms enum
 */
enum CompressionAlgorithm {
  GZIP = 'gzip',
  DEFLATE = 'deflate',
  BROTLI = 'br',
  NONE = 'none'
}

/**
 * Parse Accept-Encoding header and determine best compression algorithm
 */
function selectCompressionAlgorithm(
  acceptEncoding: string | undefined,
  enableBrotli: boolean
): CompressionAlgorithm {
  if (!acceptEncoding) {
    return CompressionAlgorithm.NONE;
  }

  const encodings = acceptEncoding.toLowerCase().split(',').map(e => e.trim());
  
  // Parse quality values and sort by preference
  const parsed = encodings.map(encoding => {
    const [name, qValue] = encoding.split(';q=');
    return {
      name: name.trim(),
      quality: qValue ? parseFloat(qValue) : 1.0
    };
  }).sort((a, b) => b.quality - a.quality);

  // Select best available algorithm
  for (const { name, quality } of parsed) {
    if (quality === 0) continue;
    
    if (enableBrotli && name === 'br') {
      return CompressionAlgorithm.BROTLI;
    }
    if (name === 'gzip') {
      return CompressionAlgorithm.GZIP;
    }
    if (name === 'deflate') {
      return CompressionAlgorithm.DEFLATE;
    }
  }

  return CompressionAlgorithm.NONE;
}

/**
 * Check if content should be compressed
 */
function shouldCompress(
  contentType: string | undefined,
  contentLength: number | undefined,
  url: string,
  config: CompressionConfig
): boolean {
  // Check minimum size threshold
  if (contentLength !== undefined && contentLength < config.threshold) {
    return false;
  }

  // Check file extension exclusions
  const extension = url.split('.').pop()?.toLowerCase();
  if (extension && config.excludeExtensions.includes(`.${extension}`)) {
    return false;
  }

  // Check MIME type
  if (!contentType) {
    return false;
  }

  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  return config.mimeTypes.some(type => 
    mimeType === type || mimeType.startsWith(type + '/')
  );
}

/**
 * Create compression stream based on algorithm
 */
function createCompressionStream(algorithm: CompressionAlgorithm, level: number) {
  switch (algorithm) {
    case CompressionAlgorithm.GZIP:
      return createGzip({ level, chunkSize: 16384 });
    case CompressionAlgorithm.DEFLATE:
      return createDeflate({ level, chunkSize: 16384 });
    case CompressionAlgorithm.BROTLI:
      return createBrotliCompress({
        params: {
          [require('zlib').constants.BROTLI_PARAM_QUALITY]: level,
          [require('zlib').constants.BROTLI_PARAM_SIZE_HINT]: 0
        }
      });
    default:
      throw new Error(`Unsupported compression algorithm: ${algorithm}`);
  }
}

/**
 * Compress data using specified algorithm
 */
async function compressData(
  data: Buffer | string,
  algorithm: CompressionAlgorithm,
  level: number
): Promise<Buffer> {
  if (algorithm === CompressionAlgorithm.NONE) {
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  const pipelineAsync = promisify(pipeline);
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const chunks: Buffer[] = [];
  
  const compressionStream = createCompressionStream(algorithm, level);
  
  compressionStream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  await pipelineAsync(
    require('stream').Readable.from([input]),
    compressionStream
  );

  return Buffer.concat(chunks);
}

/**
 * Create compression middleware
 */
export function createCompressionMiddleware(config: Partial<CompressionConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async function compressionMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Skip compression for certain conditions
    if (
      request.method === 'HEAD' ||
      reply.getHeader('content-encoding') ||
      reply.statusCode === 204 ||
      reply.statusCode === 304
    ) {
      return;
    }

    const acceptEncoding = request.headers['accept-encoding'] as string;
    const algorithm = selectCompressionAlgorithm(acceptEncoding, finalConfig.enableBrotli);

    if (algorithm === CompressionAlgorithm.NONE) {
      return;
    }

    // Hook into the response to compress it
    const originalSend = reply.send.bind(reply);
    
    reply.send = function(payload: any): any {
      // Get content info
      const contentType = reply.getHeader('content-type') as string;
      const contentLength = payload ? Buffer.byteLength(JSON.stringify(payload)) : 0;
      
      // Check if we should compress
      if (!shouldCompress(contentType, contentLength, request.url, finalConfig)) {
        return originalSend(payload);
      }

      // Compress the payload asynchronously
      const startTime = Date.now();
      
      compressData(
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        algorithm,
        finalConfig.level
      ).then(compressed => {
        const compressionTime = Date.now() - startTime;
        const originalSize = contentLength;
        const compressedSize = compressed.length;
        const compressionRatio = originalSize > 0 ? (1 - compressedSize / originalSize) * 100 : 0;

        // Set compression headers
        reply.header('content-encoding', algorithm);
        reply.header('content-length', compressedSize);
        reply.header('vary', 'accept-encoding');
        
        // Add compression stats headers (for debugging)
        if (process.env.NODE_ENV === 'development') {
          reply.header('x-compression-ratio', compressionRatio.toFixed(2) + '%');
          reply.header('x-compression-time', compressionTime + 'ms');
          reply.header('x-original-size', originalSize.toString());
          reply.header('x-compressed-size', compressedSize.toString());
        }

        // Log compression stats
        Logger.debug('Response compressed', {
          algorithm,
          originalSize,
          compressedSize,
          compressionRatio: compressionRatio.toFixed(2) + '%',
          compressionTime,
          url: request.url
        });

        // Send compressed response
        reply.type(contentType || 'application/octet-stream');
        reply.raw.end(compressed);
        
      }).catch(error => {
        Logger.error('Compression failed, sending uncompressed', 
          error instanceof Error ? error : new Error(String(error)),
          { url: request.url, algorithm }
        );
        
        // Fallback to uncompressed
        originalSend(payload);
      });

      // Return the reply object
      return reply;
    };
  };
}

/**
 * Fastify plugin for compression
 */
export async function compressionPlugin(
  fastify: FastifyInstance,
  options: Partial<CompressionConfig> = {}
) {
  const middleware = createCompressionMiddleware(options);
  
  fastify.addHook('preHandler', middleware);
  
  Logger.info('Compression middleware registered', {
    threshold: options.threshold || DEFAULT_CONFIG.threshold,
    enableBrotli: options.enableBrotli ?? DEFAULT_CONFIG.enableBrotli,
    level: options.level || DEFAULT_CONFIG.level
  });
}

/**
 * Compression statistics collector
 */
export class CompressionStats {
  private static stats = {
    totalRequests: 0,
    compressedRequests: 0,
    totalOriginalBytes: 0,
    totalCompressedBytes: 0,
    algorithmUsage: {
      [CompressionAlgorithm.GZIP]: 0,
      [CompressionAlgorithm.DEFLATE]: 0,
      [CompressionAlgorithm.BROTLI]: 0,
      [CompressionAlgorithm.NONE]: 0
    },
    averageCompressionTime: 0
  };

  static recordCompression(
    algorithm: CompressionAlgorithm,
    originalSize: number,
    compressedSize: number,
    compressionTime: number
  ): void {
    this.stats.totalRequests++;
    this.stats.algorithmUsage[algorithm]++;
    
    if (algorithm !== CompressionAlgorithm.NONE) {
      this.stats.compressedRequests++;
      this.stats.totalOriginalBytes += originalSize;
      this.stats.totalCompressedBytes += compressedSize;
      
      // Update average compression time
      const totalTime = this.stats.averageCompressionTime * (this.stats.compressedRequests - 1);
      this.stats.averageCompressionTime = (totalTime + compressionTime) / this.stats.compressedRequests;
    }
  }

  static getStats(): {
    totalRequests: number;
    compressedRequests: number;
    compressionRate: number;
    totalBytesSaved: number;
    averageCompressionRatio: number;
    averageCompressionTime: number;
    algorithmUsage: Record<string, number>;
  } {
    const bytesSaved = this.stats.totalOriginalBytes - this.stats.totalCompressedBytes;
    const compressionRate = this.stats.totalRequests > 0 
      ? (this.stats.compressedRequests / this.stats.totalRequests) * 100 
      : 0;
    const averageCompressionRatio = this.stats.totalOriginalBytes > 0
      ? (bytesSaved / this.stats.totalOriginalBytes) * 100
      : 0;

    return {
      totalRequests: this.stats.totalRequests,
      compressedRequests: this.stats.compressedRequests,
      compressionRate,
      totalBytesSaved: bytesSaved,
      averageCompressionRatio,
      averageCompressionTime: this.stats.averageCompressionTime,
      algorithmUsage: { ...this.stats.algorithmUsage }
    };
  }

  static reset(): void {
    this.stats = {
      totalRequests: 0,
      compressedRequests: 0,
      totalOriginalBytes: 0,
      totalCompressedBytes: 0,
      algorithmUsage: {
        [CompressionAlgorithm.GZIP]: 0,
        [CompressionAlgorithm.DEFLATE]: 0,
        [CompressionAlgorithm.BROTLI]: 0,
        [CompressionAlgorithm.NONE]: 0
      },
      averageCompressionTime: 0
    };
  }
}

/**
 * Predefined compression configurations
 */
export const CompressionConfigs = {
  // High compression for slow connections
  high: {
    threshold: 512,
    level: 9,
    enableBrotli: true
  },

  // Balanced compression (default)
  balanced: {
    threshold: 1024,
    level: 6,
    enableBrotli: true
  },

  // Fast compression for high-traffic scenarios
  fast: {
    threshold: 2048,
    level: 1,
    enableBrotli: false
  },

  // API responses only
  apiOnly: {
    threshold: 256,
    level: 6,
    enableBrotli: true,
    mimeTypes: ['application/json', 'text/plain']
  }
};

export default compressionPlugin;
